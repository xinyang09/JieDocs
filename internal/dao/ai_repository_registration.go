package dao

// AI lifecycle records live in the main database. They contain only bounded
// protocol metadata and are keyed by UID, so the service can use one durable
// store even when note bodies are routed to per-user databases.
func init() {
	RegisterModel(ModelConfig{Name: "AIRun", IsMainDB: true})
	RegisterModel(ModelConfig{Name: "AIUsage", IsMainDB: true})
	RegisterModel(ModelConfig{Name: "AIProposal", IsMainDB: true})
	RegisterModel(ModelConfig{Name: "AIRequestAudit", IsMainDB: true})
	RegisterModel(ModelConfig{Name: "AIProviderProfile", IsMainDB: true})
}
