package util

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/denisbrodbeck/machineid"
	"github.com/google/uuid"
)

var (
	machineID      string
	machineIDMutex sync.Mutex
	uuidPath       = "config/.server_uuid" // Default path // 默认路径
)

// SetUUIDPath sets the path for fallback server UUID file
// SetUUIDPath 设置用于回退的服务器 UUID 文件路径
func SetUUIDPath(path string) {
	machineIDMutex.Lock()
	uuidPath = path
	machineIDMutex.Unlock()
}

// GetMachineID gets unique identifier of the current machine
// GetMachineID 获取当前机器的唯一标识符
// Prioritize machineid library, fallback to motherboard serial number. If both fails, fallback to random UUID file
// 优先使用 machineid 库，失败则尝试获取主板序列号。如果都失败，则退回到随机 UUID 持久化文件
// return: machine ID string, returns empty string if all failed
// 返回值: 机器ID字符串，如果全部获取失败则返回空字符串
func GetMachineID() string {
	machineIDMutex.Lock()
	defer machineIDMutex.Unlock()

	if machineID != "" {
		return machineID
	}

	// 1. Try using machineid library
	// 1. 尝试使用 machineid 库
	id, err := machineid.ID()
	if err == nil && id != "" {
		machineID = id
		return machineID
	}

	// 2. Try getting motherboard serial number
	// 2. 尝试获取主板序列号
	id, err = getMotherboardID()
	if err == nil && id != "" {
		machineID = id
		return machineID
	}

	// 3. Fallback: load or generate UUID from configured path
	// 3. Fallback: 从配置路径加载或生成 UUID
	if uuidPath != "" {
		// Read saved UUID
		// 读取已保存的 UUID
		data, err := os.ReadFile(uuidPath)
		if err == nil {
			savedUUID := strings.TrimSpace(string(data))
			if savedUUID != "" {
				machineID = savedUUID
				return machineID
			}
		}

		// Ensure parent directory exists
		// 确保父目录存在
		parentDir := filepath.Dir(uuidPath)
		_ = os.MkdirAll(parentDir, 0755)

		// Generate and write new UUID
		// 生成并写入新 UUID
		newUUID := uuid.New().String()
		if err := os.WriteFile(uuidPath, []byte(newUUID), 0600); err == nil {
			machineID = newUUID
			return machineID
		}
	}

	// 4. All failed, return empty string
	// 4. 全部失败，返回空字符串
	// Caller should determine if machine ID was successfully obtained based on the return value
	// 调用者应根据返回值判断是否成功获取机器ID
	return ""
}

// getMotherboardID gets the serial number of the motherboard
// getMotherboardID 获取主板序列号
func getMotherboardID() (string, error) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("wmic", "baseboard", "get", "serialnumber")
	case "linux":
		// Read file
		// 读取文件
		content, err := os.ReadFile("/sys/class/dmi/id/board_serial")
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(content)), nil
	case "darwin":
		// IOPlatformUUID is stable for the current macOS installation and is
		// available without administrator privileges. Keep the serial number as
		// a fallback for older or restricted macOS environments.
		cmd = exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice")
	default:
		return "", errors.New("unsupported os")
	}

	if cmd != nil {
		out, err := cmd.Output()
		if err != nil {
			return "", err
		}
		if runtime.GOOS == "darwin" {
			if id := parseIOPlatformIdentifier(string(out)); id != "" {
				return id, nil
			}
			return "", errors.New("IOPlatformUUID or IOPlatformSerialNumber not found")
		}
		return parseSerialNumber(string(out)), nil
	}

	return "", errors.New("unknown error")
}

// parseIOPlatformIdentifier extracts a stable identifier from ioreg output.
// Prefer IOPlatformUUID because it is the identifier exposed by macOS for the
// current installation, and fall back to IOPlatformSerialNumber when needed.
func parseIOPlatformIdentifier(output string) string {
	var serial string
	for _, line := range strings.Split(output, "\n") {
		keyValue := strings.SplitN(line, "=", 2)
		if len(keyValue) != 2 {
			continue
		}
		key := strings.Trim(strings.TrimSpace(keyValue[0]), "\"")
		value := strings.Trim(strings.TrimSpace(keyValue[1]), "\"")
		if value == "" {
			continue
		}
		switch key {
		case "IOPlatformUUID":
			return value
		case "IOPlatformSerialNumber":
			if serial == "" {
				serial = value
			}
		}
	}
	return serial
}

// parseSerialNumber parses the serial number from command output
// parseSerialNumber 从命令输出中解析序列号
func parseSerialNumber(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.EqualFold(line, "SerialNumber") {
			continue
		}
		return line
	}
	return ""
}
