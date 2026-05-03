#!/usr/bin/env bash
set -euo pipefail

KEYCHAIN="${BACKGROUND_COMPUTER_USE_DEV_KEYCHAIN:-$HOME/Library/Keychains/background-computer-use-dev.keychain-db}"
KEYCHAIN_PASSWORD="${BACKGROUND_COMPUTER_USE_DEV_KEYCHAIN_PASSWORD:-}"
ROOT_COMMON_NAME="BackgroundComputerUse Local Root"
LEAF_COMMON_NAME="BackgroundComputerUse Local Dev"
TMP_DIR="$(mktemp -d /tmp/background-computer-use-signing.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

if security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "$LEAF_COMMON_NAME"; then
  echo "Signing identity already present in $KEYCHAIN"
  exit 0
fi

cat > "$TMP_DIR/root.cnf" <<'EOF'
[ req ]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[ dn ]
CN = BackgroundComputerUse Local Root
O = BackgroundComputerUse
OU = Local Development

[ v3_ca ]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
EOF

cat > "$TMP_DIR/leaf.cnf" <<'EOF'
[ req ]
distinguished_name = dn
prompt = no

[ dn ]
CN = BackgroundComputerUse Local Dev
O = BackgroundComputerUse
OU = Local Development
EOF

cat > "$TMP_DIR/leaf-ext.cnf" <<'EOF'
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
  -config "$TMP_DIR/root.cnf" \
  -keyout "$TMP_DIR/root.key" \
  -out "$TMP_DIR/root.crt" \
  >/dev/null 2>&1

openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -config "$TMP_DIR/leaf.cnf" \
  -keyout "$TMP_DIR/leaf.key" \
  -out "$TMP_DIR/leaf.csr" \
  >/dev/null 2>&1

openssl x509 -req \
  -in "$TMP_DIR/leaf.csr" \
  -CA "$TMP_DIR/root.crt" \
  -CAkey "$TMP_DIR/root.key" \
  -CAcreateserial \
  -out "$TMP_DIR/leaf.crt" \
  -days 3650 \
  -sha256 \
  -extfile "$TMP_DIR/leaf-ext.cnf" \
  >/dev/null 2>&1

openssl pkcs12 -export \
  -inkey "$TMP_DIR/leaf.key" \
  -in "$TMP_DIR/leaf.crt" \
  -certfile "$TMP_DIR/root.crt" \
  -out "$TMP_DIR/leaf.p12" \
  -passout pass:codexdev \
  >/dev/null 2>&1

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN" 2>/dev/null || true
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"

CURRENT_KEYCHAINS=$(security list-keychains -d user | tr -d '"')
security list-keychains -d user -s "$KEYCHAIN" $CURRENT_KEYCHAINS >/dev/null

security import "$TMP_DIR/leaf.p12" \
  -k "$KEYCHAIN" \
  -P codexdev \
  -A \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  >/dev/null

security add-trusted-cert \
  -r trustRoot \
  -p codeSign \
  -k "$KEYCHAIN" \
  "$TMP_DIR/root.crt" \
  >/dev/null

security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$KEYCHAIN" \
  >/dev/null

echo "Created local code-signing identity in $KEYCHAIN"
security find-identity -v -p codesigning "$KEYCHAIN"
