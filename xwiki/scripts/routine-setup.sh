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
