#!/bin/bash
# Build release zip packages for Chrome and Firefox.
# Run from the extension/ directory.

set -e

if [[ $(basename "$(pwd)") != 'extension' ]]; then
    echo 'Run this script from the extension/ directory'
    exit 1
fi

echo "latest tags:"
git tag | tail -n 5 | sort -r

printf "\ncreate new version:\n"
read -r VERSION

mkdir -p ../release

# firefox
cp manifest-firefox.json manifest.json
zip -rq ../release/cookie-sync-"$VERSION"-firefox.zip . \
    -x manifest-chrome.json -x manifest-firefox.json \
    -x "node_modules/*" -x package.json -x package-lock.json \
    -x eslint.config.js -x deploy.sh
rm manifest.json

# chrome
cp manifest-chrome.json manifest.json
zip -rq ../release/cookie-sync-"$VERSION"-chrome.zip . \
    -x manifest-chrome.json -x manifest-firefox.json \
    -x "node_modules/*" -x package.json -x package-lock.json \
    -x eslint.config.js -x deploy.sh
rm manifest.json

git tag -a "$VERSION" -m "release $VERSION"
git push origin "$VERSION"

echo "Released $VERSION"
