"""Whether `react-native.config.js` keeps one package off the iOS target.

Read by `scripts/assert-ios-push.sh`, check 6d, which is the guard that keeps
#334 undone-able: without the exclusion, `use_native_modules!` links every
package that carries a podspec, Firebase comes back into the iPhone, and
nothing anywhere goes red.

WHY A REGULAR EXPRESSION AND NOT `node -p`. `checks` must run on a runner that
has already installed the workspace, but this file is read before anything
else and by a script whose other five checks need only python3 and sed --
`assert-ios-push.sh` says why that matters. Running the configuration would
also accept a file that computes the exclusion at run time, which is a file
nobody can read the answer out of.

Usage: ios-excluded.py <path to react-native.config.js> <package name>
Exits 0 when the package's `platforms.ios` is `null`, 1 otherwise.
"""

import re
import sys


def excluded(source: str, package: str) -> bool:
    """The package's entry, up to `ios: null` inside its `platforms` object.

    `[^}]*` twice: the entry may carry a comment or another key before
    `platforms`, and `platforms` may name android beside ios -- but neither
    may contain a nested object, which is what would let this match across two
    packages' entries and report the wrong one as excluded.
    """
    entry = re.escape("'" + package + "'") + r"\s*:\s*\{[^}]*"
    platforms = r"platforms\s*:\s*\{[^}]*\bios\s*:\s*null\b"
    return re.search(entry + platforms, source) is not None


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as config:
        sys.exit(0 if excluded(config.read(), sys.argv[2]) else 1)
