package api_router

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/twofa"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type TwoFAHandler struct {
	*Handler
}

func NewTwoFAHandler(container *app.App) *TwoFAHandler {
	return &TwoFAHandler{Handler: NewHandler(container)}
}

func (handler *TwoFAHandler) authorize(ctx *gin.Context) bool {
	ctx.Header("Cache-Control", "no-store, private")
	ctx.Header("Pragma", "no-cache")
	if pkgapp.GetUID(ctx) <= 0 {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"status": false, "message": "请先登录。"})
		return false
	}
	issueType, _ := ctx.Get("token_issue_type")
	clientType, _ := ctx.Get("token_client_type")
	clientTypeName, _ := clientType.(string)
	if issueType != 1 || !pkgapp.MatchWildcard("webgui", clientTypeName) {
		ctx.AbortWithStatusJSON(http.StatusForbidden, gin.H{"status": false, "message": "2FA 仅允许网页登录会话访问。"})
		return false
	}
	return true
}

func (handler *TwoFAHandler) fail(ctx *gin.Context, err error) {
	var validation twofa.ValidationError
	switch {
	case errors.As(err, &validation):
		ctx.JSON(http.StatusBadRequest, gin.H{"status": false, "message": validation.Error()})
	case errors.Is(err, gorm.ErrRecordNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"status": false, "message": "2FA 账户不存在或已删除。"})
	default:
		handler.App.Logger().Error("2FA operation failed", zap.Error(err))
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"status": false, "message": "2FA 暂不可用，请检查服务端数据库和加密密钥配置。"})
	}
}

func (handler *TwoFAHandler) List(ctx *gin.Context) {
	if !handler.authorize(ctx) {
		return
	}
	now := time.Now()
	accounts, err := handler.App.TwoFA.List(ctx.Request.Context(), pkgapp.GetUID(ctx), now)
	if err != nil {
		handler.fail(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"status": true, "data": gin.H{"accounts": accounts, "serverTime": now.UnixMilli()}})
}

func (handler *TwoFAHandler) Save(ctx *gin.Context) {
	if !handler.authorize(ctx) {
		return
	}
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, 16*1024)
	var input twofa.Input
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"status": false, "message": "请提交有效的 2FA 账户信息。"})
		return
	}
	id, err := handler.App.TwoFA.Save(ctx.Request.Context(), pkgapp.GetUID(ctx), ctx.Param("id"), input)
	if err != nil {
		handler.fail(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"status": true, "data": gin.H{"id": id}})
}

func (handler *TwoFAHandler) Delete(ctx *gin.Context) {
	if !handler.authorize(ctx) {
		return
	}
	if err := handler.App.TwoFA.Delete(ctx.Request.Context(), pkgapp.GetUID(ctx), ctx.Param("id")); err != nil {
		handler.fail(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"status": true, "data": nil})
}
