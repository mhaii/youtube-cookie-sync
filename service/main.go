package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"golang.org/x/crypto/pbkdf2"
	"crypto/sha256"
)

// set via -ldflags at build time
var (
	version = "dev"
	commit  = "unknown"
)

const (
	pbkdf2Salt       = "youtube-cookie-sync-v1"
	pbkdf2Iterations = 100000
	keyLen           = 32
)

type encryptedPayload struct {
	IV   string `json:"iv"`
	Data string `json:"data"`
}

type jsonResponse struct {
	OK    *bool  `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}

var derivedKey []byte
var cookieFile string

func deriveKey(psk string) []byte {
	return pbkdf2.Key([]byte(psk), []byte(pbkdf2Salt), pbkdf2Iterations, keyLen, sha256.New)
}

func decrypt(key []byte, payload encryptedPayload) (string, error) {
	iv, err := base64.StdEncoding.DecodeString(payload.IV)
	if err != nil {
		return "", fmt.Errorf("invalid iv: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil {
		return "", fmt.Errorf("invalid data: %w", err)
	}
	if len(iv) != 12 {
		return "", fmt.Errorf("iv must be 12 bytes, got %d", len(iv))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm init: %w", err)
	}

	plaintext, err := gcm.Open(nil, iv, data, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed — wrong PSK or corrupted payload")
	}

	return string(plaintext), nil
}

func atomicWrite(path string, content string) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeJSON(w http.ResponseWriter, status int, resp jsonResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}

func handleCookie(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, jsonResponse{Error: "method not allowed"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10 MB limit
	if err != nil {
		writeJSON(w, http.StatusBadRequest, jsonResponse{Error: fmt.Sprintf("failed to read body: %v", err)})
		return
	}

	var payload encryptedPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, jsonResponse{Error: fmt.Sprintf("invalid JSON: %v", err)})
		return
	}

	plaintext, err := decrypt(derivedKey, payload)
	if err != nil {
		log.Printf("decryption error: %v", err)
		writeJSON(w, http.StatusBadRequest, jsonResponse{Error: err.Error()})
		return
	}

	if err := atomicWrite(cookieFile, plaintext); err != nil {
		log.Printf("write error: %v", err)
		writeJSON(w, http.StatusInternalServerError, jsonResponse{Error: fmt.Sprintf("failed to write file: %v", err)})
		return
	}

	log.Printf("cookies written to %s", cookieFile)
	ok := true
	writeJSON(w, http.StatusOK, jsonResponse{OK: &ok})
}

func main() {
	log.Printf("cookie-sync version=%s commit=%s", version, commit)

	psk := os.Getenv("PSK")
	if psk == "" {
		log.Fatal("ERROR: PSK environment variable is required")
	}

	cookieFile = os.Getenv("COOKIE_FILE")
	if cookieFile == "" {
		cookieFile = "./cookies.txt"
	}
	// ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(cookieFile), 0755); err != nil {
		log.Fatalf("failed to create directory for cookie file: %v", err)
	}

	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := host + ":" + port

	// derive key once at startup
	derivedKey = deriveKey(psk)

	mux := http.NewServeMux()
	mux.HandleFunc("/cookie", handleCookie)

	log.Printf("cookie-sync-service listening on http://%s", addr)
	log.Printf("writing cookies to %s", cookieFile)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
