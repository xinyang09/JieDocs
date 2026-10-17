package util

import "testing"

func TestParseIOPlatformIdentifier(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   string
	}{
		{
			name: "prefers platform uuid",
			output: `
  "IOPlatformSerialNumber" = "SERIAL-123"
  "IOPlatformUUID" = "UUID-123"
`,
			want: "UUID-123",
		},
		{
			name: "falls back to serial number",
			output: `
  "IOPlatformSerialNumber" = "SERIAL-123"
`,
			want: "SERIAL-123",
		},
		{
			name: "ignores unrelated keys",
			output: `
  "IOPlatformProductName" = "MacBookPro"
`,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseIOPlatformIdentifier(tt.output); got != tt.want {
				t.Fatalf("parseIOPlatformIdentifier() = %q, want %q", got, tt.want)
			}
		})
	}
}
