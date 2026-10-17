package twofa

import (
	"testing"
	"time"
)

func TestGenerateRFC6238SHA1Vector(t *testing.T) {
	code, expiresAt, err := Generate(Input{
		Name:      "test",
		Secret:    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
		Algorithm: "SHA1",
		Digits:    8,
		Period:    30,
	}, time.Unix(59, 0))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if code != "94287082" {
		t.Fatalf("Generate() code = %s, want 94287082", code)
	}
	if expiresAt != 60_000 {
		t.Fatalf("Generate() expiresAt = %d, want 60000", expiresAt)
	}
}

func TestNormalizeOtpauthURI(t *testing.T) {
	input, err := Normalize(Input{Secret: "otpauth://totp/Acme%3Aalice%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme&algorithm=SHA256&digits=8&period=60"})
	if err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if input.Name != "Acme" || input.Account != "alice@example.com" || input.Algorithm != "SHA256" || input.Digits != 8 || input.Period != 60 {
		t.Fatalf("Normalize() = %#v", input)
	}
}
