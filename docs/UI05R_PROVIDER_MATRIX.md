# UI-05R — Provider Support & Protocol Matrix V1

> **Companion Specification**: Complements `docs/UI05R_PROVIDER_CONNECTION_ARCHITECTURE.md`  
> **Status**: DRAFT SPECIFICATION  
> **Repository**: `ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension`  

---

## 1. Full Provider Classification Matrix

| Provider Identifier | Clean Display Name | Legacy UI Name | Category | Wire Protocol | Auth Style | Default Base URL | Vision Support | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `anthropic` | **Anthropic** | Anthropic (Claude) | Recommended | `anthropic_messages` | `x-api-key` | `https://api.anthropic.com` | Model-dependent (Yes for 3.5/Opus/Sonnet) | CURRENT_RUNTIME_SUPPORTED |
| `openai` | **OpenAI** | OpenAI (GPT) | Recommended | `openai_chat_completions` | `Bearer` | `https://api.openai.com` | Model-dependent (Yes for 4o/5.x) | CURRENT_RUNTIME_SUPPORTED |
| `deepseek` | **DeepSeek** | DeepSeek | Recommended | `openai_chat_completions` | `Bearer` | `https://api.deepseek.com` | Text-only (No for V3/R1) | CURRENT_RUNTIME_SUPPORTED |
| `gemini` | **Google AI** | Google Gemini | Recommended | `gemini_content` | Query param (`?key=`) | `https://generativelanguage.googleapis.com` | Model-dependent (Yes for 1.5/2.x) | CURRENT_RUNTIME_SUPPORTED |
| `qwen` | **阿里云百炼** | 阿里云通义千问 | Cloud | `openai_chat_completions` | `Bearer` | `https://dashscope.aliyuncs.com/compatible-mode` | Model-dependent (Yes for VL series) | CURRENT_RUNTIME_SUPPORTED |
| `moonshot` | **Moonshot AI** | Moonshot Kimi | Cloud | `openai_chat_completions` | `Bearer` | `https://api.moonshot.cn` | Model-dependent (Yes for Kimi-k2) | CURRENT_RUNTIME_SUPPORTED |
| `zhipu` | **智谱 AI** | 智谱 GLM | Cloud | `openai_chat_completions` | `Bearer` | `https://open.bigmodel.cn/api/paas` | Model-dependent (Yes for GLM-4V/5V) | CURRENT_RUNTIME_SUPPORTED |
| `minimax` | **MiniMax** | MiniMax | Cloud | `openai_chat_completions` | `Bearer` | `https://api.minimaxi.com` | Model-dependent (Yes for M2/M3) | CURRENT_RUNTIME_SUPPORTED |
| `ollama` | **Ollama** | Ollama（本地） | Local | `openai_chat_completions` | None / Optional | `http://localhost:11434` | Model-dependent (e.g. llava, qwen-vl) | CURRENT_RUNTIME_SUPPORTED |
| `custom` | **自定义 API** | Custom（OpenAI 兼容） | Custom | User selectable (`openai` / `anthropic`) | User selectable | User specified | User configurable (Fails closed) | CURRENT_RUNTIME_SUPPORTED |
| `openrouter` | **OpenRouter** | *(None)* | Gateway | `openai_chat_completions` | `Bearer` | `https://openrouter.ai/api/v1` | Multi-model aggregator | CATALOG_DESIGN_CANDIDATE |
| `siliconflow`| **SiliconFlow** | *(None)* | Gateway | `openai_chat_completions` | `Bearer` | `https://api.siliconflow.cn/v1` | Multi-model aggregator | CATALOG_DESIGN_CANDIDATE |
| `volcengine` | **火山引擎方舟** | *(None)* | Cloud | `openai_chat_completions` | `Bearer` | `https://ark.cn-beijing.volces.com/api/v3` | Endpoint-dependent | CATALOG_DESIGN_CANDIDATE |
| `lmstudio`   | **LM Studio** | *(None)* | Local | `openai_chat_completions` | None / Optional | `http://localhost:1234/v1` | Model-dependent | CATALOG_DESIGN_CANDIDATE |
| `azure_openai`| **Azure OpenAI** | *(None)* | Enterprise | `azure_openai_chat` | `api-key` header | Custom resource URL | Deployment-dependent | FUTURE_RUNTIME_CANDIDATE |
| `vertex_ai`  | **Vertex AI** | *(None)* | Enterprise | `vertex_gemini` | GCP OAuth2 / SA Bearer | Regional GCP endpoint | Model-dependent | FUTURE_RUNTIME_CANDIDATE |

---

## 2. Evaluation of Future Provider Candidates

### 2.1 EASY_PRESET (No Core Runtime Adapter Changes Required)
- **OpenRouter**: Uses standard OpenAI Chat Completions API with `Authorization: Bearer <key>`. Compatible with existing `callOpenAICompat`.
- **SiliconFlow (硅基流动)**: Standard OpenAI Chat Completions API on Chinese high-speed cloud infrastructure. Compatible with existing `callOpenAICompat`.
- **LM Studio**: Drop-in local OpenAI-compatible server running on port 1234. Identical wire protocol to Ollama in OpenAI mode.
- **Volcengine Ark (火山引擎方舟)**: OpenAI-compatible API; endpoint IDs are passed directly as the `model` identifier. Compatible with existing `callOpenAICompat`.
- **Groq / Mistral / xAI**: Standard OpenAI-compatible endpoints with Bearer auth.

### 2.2 REQUIRES_NEW_RUNTIME_CONTRACT (Requires Dedicated Protocol / Auth Handlers)
- **Azure OpenAI**: Uses custom URL pathing (`/openai/deployments/{deployment-id}/chat/completions?api-version={api-version}`) and `api-key` header instead of `Authorization: Bearer`. Requires dedicated provider configuration fields (`deploymentId`, `apiVersion`).
- **Google Cloud Vertex AI**: Requires Google Cloud Service Account credentials or OAuth2 exchange, distinct regional endpoints (`{region}-aiplatform.googleapis.com`), and GCP project number routing.

### 2.3 DEFER
- Direct self-hosted vLLM / TGI without reverse proxy (handled cleanly via Custom API).
- Proprietary enterprise gateways with dynamic mTLS or corporate SSO.
