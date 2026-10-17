package util

import "testing"

func TestContentTypeByPathOfficeAndPDF(t *testing.T) {
	tests := map[string]string{
		"report.DOC":  "application/msword",
		"report.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"report.pdf":  "application/pdf",
		"book.XLS":    "application/vnd.ms-excel",
		"book.xlsx":   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"book.xlsm":   "application/vnd.ms-excel.sheet.macroEnabled.12",
		"deck.PPT":    "application/vnd.ms-powerpoint",
		"deck.pptx":   "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"deck.ppsx":   "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
		"notes.odt":   "application/vnd.oasis.opendocument.text",
		"table.ods":   "application/vnd.oasis.opendocument.spreadsheet",
		"slides.odp":  "application/vnd.oasis.opendocument.presentation",
	}

	for path, want := range tests {
		if got := ContentTypeByPath(path); got != want {
			t.Errorf("ContentTypeByPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestContentTypeByPathFallbacks(t *testing.T) {
	if got := ContentTypeByPath("data.json"); got != "application/json" {
		t.Fatalf("ContentTypeByPath(json) = %q, want application/json", got)
	}
	if got := ContentTypeByPath("data.unknown"); got != "application/octet-stream" {
		t.Fatalf("ContentTypeByPath(unknown) = %q, want application/octet-stream", got)
	}
}
