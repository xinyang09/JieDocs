package routers

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
)

const maxPiSkillContent = 512 * 1024

var piSkillNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,79}$`)

type piSkill struct {
	ID          string `json:"id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"-"`
	Source      string `json:"source"`
	Content     string `json:"-"`
}

type piSkillInstallRequest struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	URL         string `json:"url"`
	Repo        string `json:"repo"`
}

func parsePiSkillMetadata(content string) (string, string) {
	lines := strings.Split(strings.TrimSpace(strings.TrimPrefix(content, "\ufeff")), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return "", ""
	}
	name, description := "", ""
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			break
		}
		key, value, found := strings.Cut(trimmed, ":")
		if !found {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		switch strings.TrimSpace(key) {
		case "name":
			name = value
		case "description":
			description = value
		}
	}
	return name, description
}

func normalizePiSkillName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if !piSkillNamePattern.MatchString(value) {
		return ""
	}
	return value
}

func collectPiSkills() ([]piSkill, error) {
	registry, err := ai.NewSkillRegistry(piSkillRoot())
	if err != nil {
		return nil, err
	}
	skills, err := registry.List()
	if err != nil {
		return nil, err
	}
	result := make([]piSkill, 0, len(skills))
	for _, skill := range skills {
		result = append(result, piSkill{ID: skill.ID, Key: skill.Key, Name: skill.Name, Description: skill.Description, Path: skill.Path, Source: skill.Source, Content: skill.Content})
	}
	sort.SliceStable(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result, nil
}

func piSkillRoot() string {
	if root := strings.TrimSpace(os.Getenv("PI_SKILL_ROOT")); root != "" {
		return root
	}
	return "skills"
}

func skillContentWithMetadata(input piSkillInstallRequest, name, content string) string {
	if metadataName, _ := parsePiSkillMetadata(content); metadataName != "" {
		return content
	}
	description := strings.TrimSpace(input.Description)
	if description == "" {
		description = strings.TrimSpace(input.Title)
	}
	if description == "" {
		description = "自定义 AI 技能"
	}
	return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", name, description, strings.TrimSpace(content))
}

func writePiSkill(name, content string) (string, error) {
	root, err := filepath.Abs(piSkillRoot())
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return "", errors.New("无法创建本地技能目录。")
	}
	if resolved, resolveErr := filepath.EvalSymlinks(root); resolveErr == nil {
		root = resolved
	}
	directory := filepath.Join(root, name)
	if info, statErr := os.Lstat(directory); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", errors.New("非法的技能保存路径。")
		}
	} else if errors.Is(statErr, os.ErrNotExist) {
		if err := os.Mkdir(directory, 0755); err != nil {
			return "", errors.New("无法创建本地技能目录。")
		}
	} else {
		return "", errors.New("无法读取本地技能目录。")
	}
	temporary, err := os.CreateTemp(directory, ".SKILL.md-*")
	if err != nil {
		return "", errors.New("无法写入本地技能文件。")
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.WriteString(content); err != nil {
		temporary.Close()
		return "", errors.New("无法写入本地技能文件。")
	}
	if err := temporary.Close(); err != nil {
		return "", errors.New("无法保存本地技能文件。")
	}
	path := filepath.Join(directory, "SKILL.md")
	if info, statErr := os.Lstat(path); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("非法的技能保存路径。")
	}
	if err := os.Rename(temporaryName, path); err != nil {
		return "", errors.New("无法保存本地技能文件。")
	}
	return path, nil
}

func handlePiSkills(c *gin.Context) {
	skills, err := collectPiSkills()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "无法读取本地技能列表。"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"skills": skills})
}

func handlePiSkillInstall(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPiSkillContent+64*1024)
	var input piSkillInstallRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "安装技能请求无效。"})
		return
	}
	if strings.TrimSpace(input.URL) != "" || strings.TrimSpace(input.Repo) != "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "为保护本地环境，在线地址暂不支持直接安装，请将 SKILL.md 内容粘贴到自定义安装页。"})
		return
	}
	name := normalizePiSkillName(input.Name)
	content := strings.TrimSpace(input.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "技能内容不能为空。"})
		return
	}
	if name == "" {
		metadataName, _ := parsePiSkillMetadata(content)
		name = normalizePiSkillName(metadataName)
	}
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "技能标识只能使用小写字母、数字、下划线和短横线。"})
		return
	}
	content = skillContentWithMetadata(input, name, content)
	if len(content) > maxPiSkillContent {
		c.JSON(http.StatusBadRequest, gin.H{"message": "技能内容超过 512 KB 限制。"})
		return
	}
	path, err := writePiSkill(name, content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	skills, err := collectPiSkills()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "技能已写入，但刷新列表失败。"})
		return
	}
	for _, skill := range skills {
		if skill.Path == path {
			c.JSON(http.StatusOK, gin.H{"message": "技能安装成功。", "skill": skill, "skills": skills})
			return
		}
	}
	c.JSON(http.StatusInternalServerError, gin.H{"message": "技能已写入，但无法读取安装结果。"})
}
