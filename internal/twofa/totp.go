package twofa

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"hash"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type Input struct {
	Name      string `json:"name"`
	Account   string `json:"account"`
	Secret    string `json:"secret"`
	Algorithm string `json:"algorithm"`
	Digits    int    `json:"digits"`
	Period    int    `json:"period"`
}

type ValidationError string

func (err ValidationError) Error() string { return string(err) }

func Normalize(input Input) (Input, error) {
	if len(input.Secret) > 4096 || len(input.Name) > 200 || len(input.Account) > 320 {
		return Input{}, ValidationError("名称、账号或密钥过长。")
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Account = strings.TrimSpace(input.Account)
	input.Secret = strings.TrimSpace(input.Secret)
	if strings.Contains(input.Secret, "://") {
		parsed, err := url.Parse(input.Secret)
		if err != nil || parsed.Scheme != "otpauth" || parsed.Host != "totp" || parsed.User != nil || parsed.Fragment != "" {
			return Input{}, ValidationError("仅支持 otpauth://totp/ 链接，不支持 HOTP 计数器验证码。")
		}
		params, err := url.ParseQuery(parsed.RawQuery)
		if err != nil {
			return Input{}, ValidationError("2FA 链接格式无效。")
		}
		for _, values := range params {
			if len(values) != 1 {
				return Input{}, ValidationError("2FA 链接包含重复参数。")
			}
		}
		label := strings.TrimPrefix(parsed.Path, "/")
		issuer, account, hasIssuer := strings.Cut(label, ":")
		if !hasIssuer {
			account, issuer = label, ""
		}
		if params.Get("issuer") != "" {
			issuer = params.Get("issuer")
		}
		if input.Name == "" {
			input.Name = strings.TrimSpace(issuer)
			if input.Name == "" {
				input.Name = strings.TrimSpace(account)
			}
		}
		if input.Account == "" {
			input.Account = strings.TrimSpace(account)
		}
		input.Secret = params.Get("secret")
		input.Algorithm = params.Get("algorithm")
		input.Digits, input.Period = 6, 30
		for key, target := range map[string]*int{"digits": &input.Digits, "period": &input.Period} {
			if params.Has(key) {
				value, err := strconv.Atoi(params.Get(key))
				if err != nil || value <= 0 {
					return Input{}, ValidationError("验证码位数或刷新周期无效。")
				}
				*target = value
			}
		}
	}
	if input.Name == "" || len(input.Name) > 200 || len(input.Account) > 320 {
		return Input{}, ValidationError("请填写名称（最多 200 字节），账号最多 320 字节。")
	}
	input.Algorithm = strings.ToUpper(strings.TrimSpace(input.Algorithm))
	if input.Algorithm == "" {
		input.Algorithm = "SHA1"
	}
	if input.Algorithm != "SHA1" && input.Algorithm != "SHA256" && input.Algorithm != "SHA512" {
		return Input{}, ValidationError("仅支持 SHA1、SHA256 和 SHA512。")
	}
	if input.Digits == 0 {
		input.Digits = 6
	}
	if input.Period == 0 {
		input.Period = 30
	}
	if (input.Digits != 6 && input.Digits != 8) || input.Period < 1 || input.Period > 300 {
		return Input{}, ValidationError("验证码须为 6 或 8 位，刷新周期须为 1–300 秒。")
	}
	input.Secret = strings.ToUpper(strings.Map(func(character rune) rune {
		if unicode.IsSpace(character) {
			return -1
		}
		return character
	}, input.Secret))
	input.Secret = strings.TrimRight(input.Secret, "=")
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(input.Secret)
	if err != nil || len(secret) < 10 || len(secret) > 128 || base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret) != input.Secret {
		return Input{}, ValidationError("请输入有效的 Base32 密钥（至少 16 个字符），或完整的 otpauth:// 链接。")
	}
	return input, nil
}

func Generate(input Input, now time.Time) (string, int64, error) {
	normalized, err := Normalize(input)
	if err != nil {
		return "", 0, err
	}
	secret, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normalized.Secret)
	var hashFunction func() hash.Hash
	switch normalized.Algorithm {
	case "SHA256":
		hashFunction = sha256.New
	case "SHA512":
		hashFunction = sha512.New
	default:
		hashFunction = sha1.New
	}
	period := int64(normalized.Period)
	counter := now.Unix() / period
	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(counter))
	mac := hmac.New(hashFunction, secret)
	mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 15
	value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
	modulus := uint32(1000000)
	if normalized.Digits == 8 {
		modulus = 100000000
	}
	return fmt.Sprintf("%0*d", normalized.Digits, value%modulus), (counter + 1) * period * 1000, nil
}
