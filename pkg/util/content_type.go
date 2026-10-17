package util

import (
	"mime"
	"path/filepath"
	"strings"
)

var contentTypesByExtension = map[string]string{
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".pdf":  "application/pdf",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
	".xltx": "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
	".xltm": "application/vnd.ms-excel.template.macroEnabled.12",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
	".pps":  "application/vnd.ms-powerpoint",
	".ppsx": "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
	".odt":  "application/vnd.oasis.opendocument.text",
	".ods":  "application/vnd.oasis.opendocument.spreadsheet",
	".odp":  "application/vnd.oasis.opendocument.presentation",
}

// ContentTypeByPath returns a stable MIME type for a file path.
// ContentTypeByPath 根据文件路径返回稳定的 MIME 类型。
//
// The explicit Office mappings are intentional: mime.TypeByExtension depends
// on the host MIME database, which is incomplete on some deployment images.
func ContentTypeByPath(filePath string) string {
	ext := strings.ToLower(filepath.Ext(filePath))
	if contentType, ok := contentTypesByExtension[ext]; ok {
		return contentType
	}
	if contentType := mime.TypeByExtension(ext); contentType != "" {
		return contentType
	}
	return "application/octet-stream"
}
