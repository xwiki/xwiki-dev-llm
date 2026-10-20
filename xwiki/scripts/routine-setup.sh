#!/bin/bash
# Setup script for the XWiki Claude routines (xwiki-ci-check, the SonarCloud sweep).
#
# A routine gets a fresh sandbox every run, so everything a skill needs beyond the checkouts has to
# be installed here, every time. Paste this into the routine's "setup script" field; it is kept in
# the repo so that a routine can be rebuilt from scratch, and so that a change to what the routines
# need is a reviewed pull request rather than an edit to a config box nobody else can see.
#
# It is written to be shared: both routines want the same GitHub CLI, the same plugin, the same
# Maven repositories and the same JDKs, and one script that is a superset costs nothing next to two
# that drift apart.
#
# The routine's sandbox needs **full** network access, not "trusted". Trusted reaches neither the
# hosts the skills work against (ci.xwiki.org, jira.xwiki.org, sonarcloud.io, matrix.org,
# nexus-snapshots.xwiki.org, bin.xwikisas.com) nor the PPAs the image carries, so the run dies here
# rather than at its first request: `apt-get update` gets 403 on deadsnakes and ondrej/php and
# exits 100, and `set -e` takes the whole setup with it ("Setup script failed with exit code
# 100").

set -euo pipefail

# --- Packages -----------------------------------------------------------------------------------
#
# `gh` is how a skill opens, assigns and locks a pull request. The two JDKs are what the maintained
# branches target — `xwiki.java.version` in xwiki-commons' pom reads 17 on stable-16.10.x and
# stable-17.10.x, and 21 from stable-18.4.x up — and they must be *installed*, not merely selected:
# `xmvn` below picks between them but cannot conjure one. Building on a too-new JDK fails in ways
# that read as code problems and are not, JaCoCo aborting with "Unsupported class file major
# version NN" so that every -Pquality build fails.

sudo apt update
sudo apt install -y gh openjdk-17-jdk openjdk-21-jdk

# --- The xwiki plugin ---------------------------------------------------------------------------
#
# The skills, the shared scripts and the org conventions all ship in it. `add` then `update` because
# the sandbox may or may not be fresh; `list` at the end so that a run whose plugin failed to load
# says so in the setup log rather than three steps later as a missing skill.

claude plugin marketplace add https://github.com/xwiki/xwiki-dev-llm
claude plugin marketplace update xwiki-dev-llm
claude plugin install xwiki@xwiki-dev-llm --scope user
claude plugin update xwiki@xwiki-dev-llm --scope user
claude plugin list

# --- xmvn -------------------------------------------------------------------------------------
#
# `xmvn` reads `xwiki.java.version` from the pom being built, exports the matching JAVA_HOME, then
# delegates to `mvn` — which is what makes one sandbox able to build every maintained branch. It
# ships with xwiki-dev-tools and finds the JDKs through `update-alternatives --list java`, which the
# apt packages above register. Without it, a build of a 17.10.x module on the default JDK fails for
# reasons that have nothing to do with the change being verified.

XWIKI_DEV_TOOLS="${HOME}/.xwiki-dev-tools"
if [[ -d "${XWIKI_DEV_TOOLS}/.git" ]]; then
  git -C "${XWIKI_DEV_TOOLS}" pull --quiet --ff-only
else
  git clone --depth 1 --quiet https://github.com/xwiki/xwiki-dev-tools.git "${XWIKI_DEV_TOOLS}"
fi
sudo ln -sf "${XWIKI_DEV_TOOLS}/bash/xmvn" /usr/local/bin/xmvn
sudo chmod +x "${XWIKI_DEV_TOOLS}/bash/xmvn"

# --- Maven settings -----------------------------------------------------------------------------
#
# XWiki's artifacts are not on Maven Central until they are released, so a build of any branch needs
# XWiki's own Nexus: snapshots for the SNAPSHOT dependencies of a development branch, and the
# release proxy for everything else.

M2_DIR="${HOME}/.m2"
SETTINGS_FILE="${M2_DIR}/settings.xml"

mkdir -p "${M2_DIR}"

cat > "${SETTINGS_FILE}" <<'EOF'
<settings>
  <profiles>
    <profile>
      <id>xwiki</id>
      <repositories>
        <repository>
          <id>xwiki-snapshots</id>
          <name>XWiki Nexus Snapshot Repository</name>
          <url>https://nexus-snapshots.xwiki.org/repository/snapshots/</url>
          <releases>
            <enabled>false</enabled>
          </releases>
          <snapshots>
            <enabled>true</enabled>
          </snapshots>
        </repository>
        <repository>
          <id>xwiki-releases</id>
          <name>XWiki Nexus Releases Repository Proxy</name>
          <url>https://nexus-snapshots.xwiki.org/repository/public-proxy</url>
          <releases>
            <enabled>true</enabled>
          </releases>
          <snapshots>
            <enabled>false</enabled>
          </snapshots>
        </repository>
      </repositories>
      <pluginRepositories>
        <pluginRepository>
          <id>xwiki-snapshots</id>
          <name>XWiki Nexus Plugin Snapshot Repository</name>
          <url>https://nexus-snapshots.xwiki.org/repository/snapshots/</url>
          <releases>
            <enabled>false</enabled>
          </releases>
          <snapshots>
            <enabled>true</enabled>
          </snapshots>
        </pluginRepository>
        <pluginRepository>
          <id>xwiki-releases</id>
          <name>XWiki Nexus Plugin Releases Repository Proxy</name>
          <url>https://nexus-snapshots.xwiki.org/repository/public-proxy</url>
          <releases>
            <enabled>true</enabled>
          </releases>
          <snapshots>
            <enabled>false</enabled>
          </snapshots>
        </pluginRepository>
      </pluginRepositories>
    </profile>
  </profiles>
  <activeProfiles>
    <activeProfile>xwiki</activeProfile>
  </activeProfiles>
</settings>
EOF

# --- Docker -------------------------------------------------------------------------------------
#
# The image ships docker, dockerd and containerd, but no daemon runs when a session starts, so
# every Docker functional test and every flicker measurement fails on a missing socket. Starting it
# here is not enough: the environment cache keeps what this script writes to disk and drops what it
# leaves running, so the daemon has to be started by each session. The starter below goes on disk
# here and runs from the SessionStart hook written in the next section. It prints on stdout only
# when the daemon failed to come up, which the hook turns into context the session can read, rather
# than a Docker IT failing an hour later for a reason nobody sees.

sudo tee /usr/local/bin/xwiki-start-dockerd > /dev/null <<'EOF'
#!/bin/bash
SUDO=
[[ $(id -u) -ne 0 ]] && SUDO=sudo
${SUDO} docker info > /dev/null 2>&1 && exit 0
${SUDO} setsid nohup dockerd > /var/log/dockerd.log 2>&1 < /dev/null &
for _ in $(seq 60); do
  ${SUDO} docker info > /dev/null 2>&1 && exit 0
  sleep 1
done
echo "dockerd did not start within 60s, so Docker tests cannot run; see /var/log/dockerd.log."
exit 0
EOF
sudo chmod +x /usr/local/bin/xwiki-start-dockerd

# --- User settings: the dockerd hook and the auto mode classifier -------------------------------
#
# Both go in ~/.claude/settings.json because it is the only settings file that reaches the routine:
# a session with several repositories reads no repo's `.claude/settings.json`, and the auto mode
# classifier never reads `autoMode` from a repo's settings anyway, so that a checkout cannot grant
# itself exceptions. Merged, not overwritten, because `claude plugin install` above keeps the
# enabled plugin in the same file.
#
# The `autoMode` entries exist because the routine prompt is not live user input and so cannot
# consent to a publication: without them the classifier blocks the PrivateBin paste as a "Public
# Data-Sharing Upload", and the Matrix digest goes out with no link to its detail. `$defaults`
# keeps every built-in rule; these only add XWiki's own hosts and name the paste as intended.

node - <<'EOF'
const fs = require('fs');
const path = require('path');
const os = require('os');

const file = path.join(os.homedir(), '.claude', 'settings.json');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  // No settings yet.
}
const union = (current, added) => [...new Set([...(current || []), ...added])];

const starter = '/usr/local/bin/xwiki-start-dockerd';
settings.hooks = settings.hooks || {};
settings.hooks.SessionStart = (settings.hooks.SessionStart || [])
  .filter((entry) => !(entry.hooks || []).some((hook) => hook.command === starter))
  .concat([{ hooks: [{ type: 'command', command: starter }] }]);

settings.autoMode = settings.autoMode || {};
settings.autoMode.environment = union(settings.autoMode.environment, [
  '$defaults',
  '**XWiki infrastructure**: this session is the XWiki project\'s scheduled CI routine. These are the'
    + ' organization\'s own services, not external destinations: the `xwiki` GitHub organization,'
    + ' ci.xwiki.org (Jenkins), jira.xwiki.org, nexus-snapshots.xwiki.org, sonarcloud.io for the'
    + ' `xwiki` organization, bin.xwikisas.com (XWiki SAS\'s own PrivateBin instance), and the'
    + ' #xwiki:matrix.xwiki.com Matrix room reached through matrix.org.',
]);
settings.autoMode.allow = union(settings.autoMode.allow, [
  '$defaults',
  'XWiki CI digest paste: running the xwiki-ci-check skill\'s `privatebin.mjs --write` to post the'
    + ' CI digest detail to bin.xwikisas.com, XWiki SAS\'s own PrivateBin instance (client-side'
    + ' encrypted, expiring within two weeks), and putting the resulting URL in the Matrix digest, is'
    + ' the routine\'s intended output and not a Public Data-Sharing Upload.',
]);

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
EOF
