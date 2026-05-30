package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// encryptForTest encrypts plaintext with AES-256-GCM using a random IV.
// Mirrors the browser extension's encryptCookies function.
func encryptForTest(key []byte, plaintext string) (encryptedPayload, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedPayload{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return encryptedPayload{}, err
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return encryptedPayload{}, err
	}
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)
	return encryptedPayload{
		IV:   base64.StdEncoding.EncodeToString(iv),
		Data: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------

func TestDeriveKeyDeterministic(t *testing.T) {
	k1 := deriveKey("my-test-psk")
	k2 := deriveKey("my-test-psk")
	if !bytes.Equal(k1, k2) {
		t.Fatal("same PSK must produce same key")
	}
}

func TestDeriveKeyDifferentPSK(t *testing.T) {
	k1 := deriveKey("psk-one")
	k2 := deriveKey("psk-two")
	if bytes.Equal(k1, k2) {
		t.Fatal("different PSKs must not produce the same key")
	}
}

func TestDeriveKeyLength(t *testing.T) {
	k := deriveKey("any-psk")
	if len(k) != keyLen {
		t.Fatalf("expected key length %d, got %d", keyLen, len(k))
	}
}

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------

func TestDecryptRoundtrip(t *testing.T) {
	const psk = "roundtrip-psk"
	const want = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tFALSE\t0\tSID\tval"

	key := deriveKey(psk)
	payload, err := encryptForTest(key, want)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	got, err := decrypt(key, payload)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDecryptWrongPSKFails(t *testing.T) {
	keyGood := deriveKey("correct-psk")
	keyBad := deriveKey("wrong-psk")

	payload, err := encryptForTest(keyGood, "secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	_, err = decrypt(keyBad, payload)
	if err == nil {
		t.Fatal("expected decryption with wrong PSK to fail")
	}
}

func TestDecryptBadBase64IV(t *testing.T) {
	payload := encryptedPayload{IV: "not!!valid!!base64", Data: "dGVzdA=="}
	_, err := decrypt(deriveKey("psk"), payload)
	if err == nil {
		t.Fatal("expected error for bad base64 IV")
	}
}

func TestDecryptWrongIVLength(t *testing.T) {
	payload := encryptedPayload{
		IV:   base64.StdEncoding.EncodeToString(make([]byte, 8)), // 8 instead of 12
		Data: base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	_, err := decrypt(deriveKey("psk"), payload)
	if err == nil {
		t.Fatal("expected error for wrong IV length")
	}
}

// ---------------------------------------------------------------------------
// atomicWrite
// ---------------------------------------------------------------------------

func TestAtomicWriteCreatesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cookies.txt")
	if err := atomicWrite(path, "cookie data"); err != nil {
		t.Fatalf("atomicWrite: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != "cookie data" {
		t.Fatalf("got %q, want %q", got, "cookie data")
	}
}

func TestAtomicWriteReplacesExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cookies.txt")
	atomicWrite(path, "first write")
	if err := atomicWrite(path, "second write"); err != nil {
		t.Fatalf("atomicWrite: %v", err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "second write" {
		t.Fatalf("got %q, want %q", got, "second write")
	}
}

func TestAtomicWriteNoTmpLeftover(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cookies.txt")
	atomicWrite(path, "content")
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("tmp file should not remain after successful write")
	}
}

// ---------------------------------------------------------------------------
// HTTP handler integration
// ---------------------------------------------------------------------------

func TestHTTPHandlerSuccess(t *testing.T) {
	const psk = "handler-test-psk"
	const plaintext = "# Netscape HTTP Cookie File\ntest-cookie-line"

	dir := t.TempDir()
	cookieFile = filepath.Join(dir, "cookies.txt")
	derivedKey = deriveKey(psk)

	payload, err := encryptForTest(derivedKey, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest(http.MethodPost, "/cookie", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	handleCookie(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	got, err := os.ReadFile(cookieFile)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != plaintext {
		t.Fatalf("file content mismatch: got %q, want %q", got, plaintext)
	}
}

func TestHTTPHandlerWrongMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/cookie", nil)
	rr := httptest.NewRecorder()
	handleCookie(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

func TestHTTPHandlerInvalidJSON(t *testing.T) {
	derivedKey = deriveKey("any-psk")
	req := httptest.NewRequest(http.MethodPost, "/cookie", bytes.NewBufferString("{bad json}"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handleCookie(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHTTPHandlerWrongPSK(t *testing.T) {
	dir := t.TempDir()
	cookieFile = filepath.Join(dir, "cookies.txt")

	keyGood := deriveKey("correct-psk")
	derivedKey = deriveKey("wrong-psk")

	payload, _ := encryptForTest(keyGood, "secret")
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest(http.MethodPost, "/cookie", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handleCookie(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for wrong PSK, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHTTPHandlerResponseJSON(t *testing.T) {
	const psk = "json-response-psk"
	dir := t.TempDir()
	cookieFile = filepath.Join(dir, "cookies.txt")
	derivedKey = deriveKey(psk)

	payload, _ := encryptForTest(derivedKey, "data")
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest(http.MethodPost, "/cookie", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	handleCookie(rr, req)

	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if resp["ok"] != true {
		t.Fatalf("expected ok=true, got %v", resp)
	}
}

func init() {
	// suppress log output during tests
	_ = fmt.Sprintf
}
