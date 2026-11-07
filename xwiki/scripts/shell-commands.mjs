// Shell command-line parsing shared by the hooks that read a Bash command: check-commit-text.mjs
// (which part of a compound command is the commit message), check-diff.mjs (whether a command
// commits, and what) and kb-hooks.mjs (whether a command can have written a file). Not a shell: good
// enough for the shapes an agent writes, and every caller
// treats a null (unbalanced quoting) as "cannot tell".

// Placeholder left where a heredoc's `<<TAG` stood (control characters, which no command holds),
// naming the body it fed.
export const HEREDOC = /\u0001(\d+)\u0001/;

// Pull heredoc bodies out of a shell command. Each `<<TAG` (`<<'TAG'`, `<<"TAG"`, `<<-TAG`) becomes a
// placeholder, and its body — the lines after the operator's line up to the one that is TAG (or TAG
// followed by the `)` closing a `$(cat <<EOF …)`) — is removed, so what remains parses as a command
// line and each body stays tied to the command it feeds. An operator whose terminator never comes is
// left alone: it was text (`a << b` in a message), not a heredoc.
export function extractHeredocs(command) {
  const lines = command.split("\n");
  const bodies = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let next = i + 1;
    let rest = "";
    const line = lines[i].replace(/<<(?!<)-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/g, (op, _q, tag) => {
      const end = new RegExp(`^[ \\t]*${tag}[ \\t]*(\\).*)?\\r?$`);
      let j = next;
      while (j < lines.length && !end.test(lines[j])) j++;
      if (j >= lines.length) return op;
      bodies.push(lines.slice(next, j).join("\n"));
      rest += end.exec(lines[j])[1] ?? "";
      next = j + 1;
      return ` \u0001${bodies.length - 1}\u0001 `;
    });
    out.push(line + rest);
    i = next - 1;
  }
  return { bodies, stripped: out.join("\n") };
}

// Split a shell command line into its simple commands — at unquoted `;`, `&`, `&&`, `|`, `||`, `(`,
// `)` and newlines — each a list of tokens `{ value, flag }`, `flag` telling an unquoted token (`-m`)
// from a quoted value that merely looks like one, and `piped` marking a command whose stdin is the
// previous one's output. Good enough for the shapes an agent actually writes; null when the quoting
// does not balance, and the caller then stays silent rather than guessing.
export function parseCommands(line) {
  const commands = [];
  let tokens = [];
  let piped = false;
  let cur = "";
  let started = false;
  let flag = false;
  const endToken = () => {
    if (started) tokens.push({ value: cur, flag });
    cur = "";
    started = false;
  };
  const endCommand = (nextPiped) => {
    endToken();
    if (tokens.length) commands.push({ tokens, piped });
    tokens = [];
    piped = nextPiped;
  };
  const take = (text, quoted) => {
    if (!started) flag = !quoted;
    cur += text;
    started = true;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      take(line.slice(i + 1, end), true);
      i = end;
    } else if (c === '"') {
      // Inside double quotes a backslash escapes only `"`, `\`, `$`, `` ` `` and a newline.
      let text = "";
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && '"\\$`\n'.includes(line[j + 1] ?? "x")) {
          if (line[j + 1] !== "\n") text += line[j + 1];
          j++;
        } else {
          text += line[j];
        }
      }
      if (j >= line.length) return null;
      take(text, true);
      i = j;
    } else if (c === "\\") {
      if (line[i + 1] !== "\n" && i + 1 < line.length) take(line[i + 1], false);
      i++;
    } else if (c === "|") {
      const pipe = line[i + 1] !== "|"; // `|` and `|&` pipe; `||` does not
      if (!pipe || line[i + 1] === "&") i++;
      endCommand(pipe);
    } else if (c === "&" && !/[<>]/.test(line[i - 1] ?? "") && line[i + 1] !== ">") {
      if (line[i + 1] === "&") i++;
      endCommand(false);
    } else if (c === ";" || c === "\n" || c === "(" || c === ")") {
      endCommand(false);
    } else if (c === "#" && !started) {
      while (i + 1 < line.length && line[i + 1] !== "\n") i++;
    } else if (/\s/.test(c)) {
      endToken();
    } else {
      take(c, false);
    }
  }
  endCommand(false);
  return commands;
}

/** A command line's simple commands, its heredocs already pulled out: `{ commands, bodies }`, or null. */
export function simpleCommands(command) {
  const { bodies, stripped } = extractHeredocs(command);
  const commands = parseCommands(stripped);
  return commands && { commands, bodies };
}

const GIT_COMMIT = /(?:^|[\s;&|(`"'])git(?:\s+-[cC]\s+\S+|\s+--?[\w.-]+(?:=\S+)?)*\s+commit(?=$|[\s;&|)`"'])/;
/** Whether a shell command runs `git commit` (also `git -C dir commit`, after `&&`, inside `bash -c "…"`). */
export const isGitCommit = (command) => typeof command === "string" && GIT_COMMIT.test(command);

/** Whether the commit also takes changes not staged yet: `-a`/`--all`, or a `git add` in the same command. */
export const takesUnstaged = (command) => /(?:^|[\s;&|(])git\s+add\b/.test(command)
  || /\scommit\b.*?\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$)/.test(command);
