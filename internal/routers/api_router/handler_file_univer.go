package api_router

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

type univerFileSpec struct {
	Kind       string
	Import     string
	Export     string
	OutputPath string
}

type univerExportRequest struct {
	Vault string          `json:"vault" binding:"required"`
	Path  string          `json:"path" binding:"required"`
	Kind  string          `json:"kind" binding:"required"`
	Data  json.RawMessage `json:"data" binding:"required"`
}

type univerImportResponse struct {
	Kind        string          `json:"kind"`
	Format      string          `json:"format"`
	FileName    string          `json:"fileName"`
	UnitData    json.RawMessage `json:"unitData"`
	SheetBlocks json.RawMessage `json:"sheetBlocks,omitempty"`
}

func univerFileSpecForPath(path string) (univerFileSpec, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	spec := univerFileSpec{}
	switch ext {
	case ".xls", ".xlsx", ".xlsm", ".csv", ".tsv":
		spec.Kind = "sheet"
		if ext == ".csv" {
			spec.Import, spec.Export = "csv", "csv"
		} else if ext == ".tsv" {
			spec.Import, spec.Export = "tsv", "tsv"
		} else if ext == ".xls" {
			spec.Import, spec.Export = "xls", "xlsx"
		} else {
			spec.Import, spec.Export = "xlsx", "xlsx"
		}
	case ".doc", ".docx":
		spec.Kind, spec.Export = "doc", "docx"
		spec.Import = "docx"
		if ext == ".doc" {
			spec.Import = "doc"
		}
	case ".ppt", ".pptx":
		spec.Kind, spec.Export = "slide", "pptx"
		spec.Import = "pptx"
		if ext == ".ppt" {
			spec.Import = "ppt"
		}
	default:
		return univerFileSpec{}, false
	}
	spec.OutputPath = path
	if spec.Export == "docx" && ext == ".doc" {
		spec.OutputPath = strings.TrimSuffix(path, ext) + ".docx"
	}
	if spec.Export == "pptx" && ext == ".ppt" {
		spec.OutputPath = strings.TrimSuffix(path, ext) + ".pptx"
	}
	if spec.Export == "xlsx" && (ext == ".xls" || ext == ".xlsm") {
		spec.OutputPath = strings.TrimSuffix(path, ext) + ".xlsx"
	}
	return spec, true
}

func (h *FileHandler) UniverImport(c *gin.Context) {
	params := &dto.FileGetRequest{}
	if valid, errs := pkgapp.BindAndValid(c, params); !valid {
		c.JSON(http.StatusBadRequest, gin.H{"message": errs.ErrorsToString()})
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	spec, ok := univerFileSpecForPath(params.Path)
	if !ok {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"message": "此文件格式暂不支持 Univer 编辑"})
		return
	}
	params.PathHash = util.EncodeHash32(params.Path)
	savePath, _, _, _, fileName, err := h.App.GetFileService(h.getClientInfo(c)).GetContentInfo(c.Request.Context(), uid, params)
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	output, err := h.runUniverExchange(c.Request.Context(), "import", savePath, spec.Kind, spec.Import, fileName)
	if err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverImport", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "此 Office 文件无法导入 Univer"})
		return
	}
	var imported struct {
		UnitData    json.RawMessage `json:"unitData"`
		Snapshot    json.RawMessage `json:"snapshot"`
		SheetBlocks json.RawMessage `json:"sheetBlocks"`
	}
	if err := json.Unmarshal(output, &imported); err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverImport.Decode", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Univer 导入结果无效"})
		return
	}
	unitData := imported.UnitData
	if len(unitData) == 0 {
		unitData, err = extractUniverUnitData(imported.Snapshot, spec.Kind)
	}
	if err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverImport.UnitData", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Univer 文件数据无效"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status": true,
		"data": univerImportResponse{
			Kind:        spec.Kind,
			Format:      spec.Export,
			FileName:    fileName,
			UnitData:    unitData,
			SheetBlocks: imported.SheetBlocks,
		},
	})
}

func (h *FileHandler) UniverExport(c *gin.Context) {
	input := &univerExportRequest{}
	if err := c.ShouldBindJSON(input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	spec, ok := univerFileSpecForPath(input.Path)
	if !ok || spec.Kind != input.Kind {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"message": "此文件格式暂不支持 Univer 导出"})
		return
	}
	params := &dto.FileGetRequest{Vault: input.Vault, Path: input.Path, PathHash: util.EncodeHash32(input.Path)}
	if _, _, _, _, _, err := h.App.GetFileService(h.getClientInfo(c)).GetContentInfo(c.Request.Context(), uid, params); err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	inputPath, outputPath, err := h.writeUniverExchangeFiles(input.Data, spec.OutputPath)
	if err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverExport.TempFiles", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "无法创建导出临时文件"})
		return
	}
	defer os.Remove(inputPath)
	defer os.Remove(outputPath)
	if _, err := h.runUniverExchange(c.Request.Context(), "export", inputPath, outputPath, spec.Kind, spec.Export); err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverExport", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "无法从 Univer 导出 Office 文件"})
		return
	}
	output, err := os.ReadFile(outputPath)
	if err != nil {
		h.logError(c.Request.Context(), "FileHandler.UniverExport.Read", err)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "导出文件读取失败"})
		return
	}
	c.Header("X-FNS-Output-Path", url.PathEscape(spec.OutputPath))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filepath.Base(spec.OutputPath))))
	c.Data(http.StatusOK, util.ContentTypeByPath(spec.OutputPath), output)
}

func (h *FileHandler) runUniverExchange(ctx context.Context, command string, args ...string) ([]byte, error) {
	script := os.Getenv("FNS_UNIVER_EXCHANGE_SCRIPT")
	if script == "" {
		script = filepath.Join("docs-viewer", "server", "univer-exchange.mjs")
	}
	if _, err := os.Stat(script); err != nil {
		return nil, fmt.Errorf("univer exchange script not found: %w", err)
	}
	nodeBinary, err := univerNodeBinary()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodeBinary, append([]string{script, command}, args...)...)
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("node exchange failed: %w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return nil, err
	}
	return output, nil
}

func univerNodeBinary() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("FNS_NODE_BIN")); configured != "" {
		if strings.ContainsRune(configured, os.PathSeparator) {
			info, err := os.Stat(configured)
			if err != nil {
				return "", fmt.Errorf("FNS_NODE_BIN is not usable: %w", err)
			}
			if info.IsDir() {
				return "", fmt.Errorf("FNS_NODE_BIN is a directory: %s", configured)
			}
			return configured, nil
		}
		binary, err := exec.LookPath(configured)
		if err != nil {
			return "", fmt.Errorf("FNS_NODE_BIN was not found: %w", err)
		}
		return binary, nil
	}
	if binary, err := exec.LookPath("node"); err == nil {
		return binary, nil
	}
	for _, candidate := range []string{"/opt/homebrew/bin/node", "/usr/local/bin/node"} {
		if info, err := os.Stat(candidate); err == nil && info.Mode()&0111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("node executable not found; install Node.js >=22.5 or set FNS_NODE_BIN")
}

func (h *FileHandler) writeUniverExchangeFiles(data json.RawMessage, outputName string) (string, string, error) {
	tempDir := h.App.Config().App.TempPath
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return "", "", err
	}
	inputFile, err := os.CreateTemp(tempDir, "fns-univer-input-*.json")
	if err != nil {
		return "", "", err
	}
	inputPath := inputFile.Name()
	if _, err := inputFile.Write(data); err != nil {
		inputFile.Close()
		os.Remove(inputPath)
		return "", "", err
	}
	if err := inputFile.Close(); err != nil {
		os.Remove(inputPath)
		return "", "", err
	}
	outputFile, err := os.CreateTemp(tempDir, "fns-univer-output-"+filepath.Base(outputName))
	if err != nil {
		os.Remove(inputPath)
		return "", "", err
	}
	outputPath := outputFile.Name()
	if err := outputFile.Close(); err != nil {
		os.Remove(inputPath)
		os.Remove(outputPath)
		return "", "", err
	}
	return inputPath, outputPath, nil
}

func extractUniverUnitData(raw json.RawMessage, kind string) (json.RawMessage, error) {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	key := map[string]string{"sheet": "workbook", "doc": "doc", "slide": "slide"}[kind]
	unitData := raw
	if nested, ok := value[key]; ok {
		unitData = nested
	}
	var unit map[string]json.RawMessage
	if err := json.Unmarshal(unitData, &unit); err != nil {
		return nil, err
	}
	if _, ok := unit["id"]; !ok {
		if unitID, ok := unit["unitID"]; ok {
			unit["id"] = unitID
		}
	}
	return json.Marshal(unit)
}
