#!/usr/bin/env bash
#
# The permission dialogs iOS draws, and the languages they are drawn in.
#
# iOS writes those boxes itself. It does not ask the application what language
# it is showing, and it never reads `src/copy/`: it reads the purpose strings
# out of the bundle, localised the way every other bundle resource is, from
# `<region>.lproj/InfoPlist.strings`. The repository had none. So the four
# strings sat in Info.plist in French, `CFBundleDevelopmentRegion` said `en`,
# and every iPhone on earth -- German, Uzbek, English -- was asked for its
# microphone in French (#320).
#
# WHAT MAKES THIS WORTH A SCRIPT RATHER THAN A HABIT. Nothing else can see it.
# A missing translation compiles, signs, uploads, passes App Store review and
# installs. The simulator build in `device.yml` proves the project is
# well-formed and says nothing about what is in the files. The failure is
# visible only to somebody holding a telephone set to that language, at the
# one moment they are being asked to trust the application with a microphone.
#
# THE SILENT HALF IS THE WIRING, and it is why this reads the pbxproj too. A
# `.lproj` that no variant group names, or a region absent from
# `knownRegions`, is a directory Xcode walks past: the build is green, the
# bundle simply does not carry it, and the dialog falls back to the plist.
# Files present and unreferenced is the shape of failure this repository has
# met before, and no unit of anything has that behaviour.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."

if ! python3 - "$ROOT" <<'PY'
import os
import re
import sys

root = sys.argv[1]
app = f'{root}/packages/app'
plist_path = f'{app}/ios/Messagr/Info.plist'
project_path = f'{app}/ios/Messagr.xcodeproj/project.pbxproj'

failed = False


def ok(line):
    print(f'  OK    {line}')


def bad(line):
    global failed
    failed = True
    print(f'  FAIL  {line}', file=sys.stderr)


# ── Which languages, read from the one place that decides ─────────────────
#
# `languages.ts` is what the strip offers and what `copy.spec.ts` holds the
# catalogues to. Reading it here rather than repeating the list is the whole
# point: an eighth language is added there, and this fails until the eighth
# purpose strings exist. A list copied into this file would agree with itself
# forever.
source = open(f'{app}/src/copy/languages.ts', encoding='utf8').read()
block = re.search(r'export const LANGUAGES = \[(.*?)\] as const',
                  source, re.S)
if not block:
    bad('languages.ts no longer declares LANGUAGES the way this reads it')
    sys.exit(1)
languages = re.findall(r"code: '([a-z]{2})'", block.group(1))
if len(languages) < 2:
    bad(f'only {len(languages)} language(s) parsed out of languages.ts: '
        'the regular expression has fallen behind the file')
    sys.exit(1)

# ── What Info.plist asks for, and in which language it asks ───────────────
import plistlib

try:
    plist = plistlib.load(open(plist_path, 'rb'))
except Exception as refused:
    bad(f'Info.plist is not well-formed XML: {refused}')
    sys.exit(1)

# Derived from the plist and not listed here. A fifth protected resource
# obliges a fifth string (`assert-ios-info-plist.sh` is what says it must
# exist at all), and it must be translated the day it arrives rather than the
# day somebody remembers this file.
wanted = sorted(k for k in plist if k.endswith('UsageDescription'))
if not wanted:
    bad('Info.plist carries no purpose string at all')
    sys.exit(1)

base = plist.get('CFBundleDevelopmentRegion')
if base not in languages:
    bad(f'CFBundleDevelopmentRegion is {base!r}, which is not one of the '
        f'languages this application speaks ({", ".join(languages)}): the '
        'fallback would be a language no catalogue exists for')
    sys.exit(1)


# ── Reading a .strings file, strictly ─────────────────────────────────────
#
# No `plutil`: this runs on the Linux job, where the failure is cheap to
# notice and the macOS minutes are not spent. The format is small enough to
# read exactly -- comments, then "key" = "value"; -- and anything this parser
# does not understand is reported rather than skipped, because a line silently
# dropped is a missing translation that looks present.
COMMENTS = re.compile(r'/\*.*?\*/', re.S)
PAIR = re.compile(r'"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;')


def read_strings(path):
    raw = open(path, 'rb').read()
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        raise ValueError('UTF-16; these files are UTF-8, as the project says')
    if raw[:3] == b'\xef\xbb\xbf':
        raise ValueError('a UTF-8 byte order mark; Xcode does not want one')
    text = raw.decode('utf8')
    stripped = COMMENTS.sub('', text)
    stripped = re.sub(r'^\s*//.*$', '', stripped, flags=re.M)
    pairs = {}
    for match in PAIR.finditer(stripped):
        key = match.group(1)
        if key in pairs:
            raise ValueError(f'{key} is declared twice')
        pairs[key] = match.group(2).replace('\\"', '"').replace('\\\\', '\\')
    leftover = PAIR.sub('', stripped).strip()
    if leftover:
        raise ValueError(
            f'{len(leftover)} characters this parser does not understand, '
            f'starting {leftover[:40]!r}')
    return pairs


catalogues = {}
for language in languages:
    path = f'{app}/ios/Messagr/{language}.lproj/InfoPlist.strings'
    if not os.path.exists(path):
        bad(f'{language} has no InfoPlist.strings: an iPhone set to it is '
            'asked for its microphone in ' + base)
        continue
    try:
        catalogues[language] = read_strings(path)
    except (ValueError, UnicodeDecodeError) as refused:
        bad(f'{language}.lproj/InfoPlist.strings cannot be read: {refused}')

if len(catalogues) == len(languages):
    ok(f'{len(languages)} languages carry an InfoPlist.strings, '
       'all of them readable')

# ── Every string, in every language ───────────────────────────────────────
for language, pairs in sorted(catalogues.items()):
    for key in wanted:
        value = pairs.get(key)
        if value is None:
            bad(f'{language} has no {key}: iOS falls back to {base} for '
                'that one box and nothing says so')
        elif len(value.strip()) < 10:
            bad(f'{language} has a {key} of {len(value.strip())} characters, '
                'which explains nothing')
    extra = sorted(set(pairs) - set(wanted))
    if extra:
        bad(f'{language} translates {", ".join(extra)}, which Info.plist does '
            'not declare: a translation of nothing')

if not failed:
    ok(f'{len(wanted)} purpose string(s) present in every language')

# ── The base is the plist, word for word ──────────────────────────────────
#
# THE RULE THAT KEEPS THE BUG FROM COMING BACK. The plist is what a telephone
# gets when it speaks none of the seven, so the plist must be in the
# development region's language -- and the only way to say that mechanically
# is to hold it to the development region's own catalogue. Somebody editing
# the plist in French again, as #320 found it, fails here.
for key in wanted:
    theirs = catalogues.get(base, {}).get(key)
    if theirs is None:
        continue
    if theirs != plist[key]:
        bad(f'Info.plist and {base}.lproj disagree on {key}. The plist is the '
            f'fallback for every language this application does not speak, '
            f'so it must say what {base} says.')
if not failed:
    ok(f'Info.plist says exactly what {base}.lproj says, so the fallback is '
       f'in {base}')

# ── No two languages saying the same sentence ─────────────────────────────
#
# The realistic mistake is not a deleted translation, it is a file copied to
# start the next language and committed before it was translated. Two
# identical sentences in two languages is that, and nothing else: these are
# whole paragraphs.
for key in wanted:
    said = {}
    for language, pairs in sorted(catalogues.items()):
        value = pairs.get(key)
        if value is None:
            continue
        if value in said:
            bad(f'{said[value]} and {language} give the same {key}, '
                'word for word: one of them was never translated')
        said[value] = language
if not failed:
    ok('no two languages give the same sentence')

# ── The project actually copies them ──────────────────────────────────────
#
# Read with regular expressions rather than a plist parser: a pbxproj is an
# OpenStep plist, which `plistlib` cannot read, and this must run on the Linux
# job. The three things asserted are the three that can each silently drop a
# language on the floor.
project = open(project_path, encoding='utf8').read()

group = re.search(
    r'([0-9A-F]{24}) /\* InfoPlist\.strings \*/ = \{\s*'
    r'isa = PBXVariantGroup;\s*children = \((.*?)\);',
    project, re.S)
if not group:
    bad('the Xcode project has no PBXVariantGroup for InfoPlist.strings: '
        'the .lproj directories are directories nothing reads')
else:
    group_id, children = group.group(1), group.group(2)
    named = set(re.findall(r'[0-9A-F]{24} /\* ([a-z]{2}) \*/', children))
    absent = [one for one in languages if one not in named]
    if absent:
        bad(f'the variant group does not name {", ".join(absent)}: '
            'those files are not copied into the bundle')
    else:
        ok(f'the variant group names all {len(languages)} languages')

    # Named is not enough: the region must be one the project knows, or Xcode
    # drops the .lproj from the product without a word.
    regions = re.search(r'knownRegions = \((.*?)\);', project, re.S)
    known = set(re.findall(r'\b([a-zA-Z]+)\b', regions.group(1) if regions
                           else ''))
    unknown = [one for one in languages if one not in known]
    if unknown:
        bad(f'knownRegions does not list {", ".join(unknown)}: Xcode prunes '
            'a region it does not know, and the build stays green')
    else:
        ok('knownRegions lists every language')

    # And the group must be in the application's Resources phase, which is the
    # step that puts anything in the bundle at all.
    build = re.search(
        r'([0-9A-F]{24}) /\* InfoPlist\.strings in Resources \*/ = '
        r'\{isa = PBXBuildFile; fileRef = ' + group_id,
        project)
    phases = re.search(
        r'/\* Begin PBXResourcesBuildPhase section \*/(.*?)'
        r'/\* End PBXResourcesBuildPhase section \*/', project, re.S)
    if not build:
        bad('no PBXBuildFile points at the InfoPlist.strings variant group: '
            'it is listed in the project and copied by no build phase')
    elif not phases or build.group(1) not in phases.group(1):
        bad('the InfoPlist.strings build file is in no Resources phase: '
            'nothing copies it into the application')
    else:
        ok("the application's Resources phase copies InfoPlist.strings")

if failed:
    print('an iPhone built from this tree would ask in the wrong language',
          file=sys.stderr)
    sys.exit(1)
PY
then
  exit 1
fi
