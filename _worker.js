// === Cloudflare SSL 自动启用 + 连接测试 + CA选择 ===
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

async function parseJson(request, requiredFields) {
  let data;
  try {
    data = await request.json();
  } catch {
    throw new Error("请求体必须是有效的 JSON 格式。");
  }
  const missing = requiredFields.filter(f => !data[f]);
  if (missing.length) throw new Error(`缺少字段: ${missing.join(", ")}`);
  return data;
}

function buildHeaders(email, apiKey, mode = "auto") {
  const headers = { "Content-Type": "application/json" };
  if (mode === "token" || apiKey.startsWith("ey") || apiKey.length > 40) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers._type = "token";
  } else {
    headers["X-Auth-Email"] = email;
    headers["X-Auth-Key"] = apiKey;
    headers._type = "key";
  }
  return headers;
}

// === 启用 SSL ===
async function handleAddSSL(request) {
  try {
    const body = await parseJson(request, ["email", "zoneId", "apiKey"]);
    const { email, zoneId, apiKey, mode = "auto", enabled = true, ca = "ssl_com" } = body;
    const headers = buildHeaders(email, apiKey, mode);

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/ssl/universal/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled, certificate_authority: ca }),
    });

    const result = await res.json();
    return jsonResponse(result, res.status);
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 400);
  }
}

// === 测试连接 ===
async function handleTestConnection(request) {
  try {
    const body = await parseJson(request, ["email", "apiKey"]);
    const { email, apiKey, mode = "auto" } = body;
    const headers = buildHeaders(email, apiKey, mode);

    const res = await fetch("https://api.cloudflare.com/client/v4/user", { headers });
    const result = await res.json();

    if (res.ok && result.success) {
      return jsonResponse({
        success: true,
        type: headers._type,
        account: result.result?.email || "未知",
        message: "认证成功",
      });
    } else {
      return jsonResponse({ success: false, message: result.errors?.[0]?.message || "认证失败" }, 400);
    }
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 400);
  }
}

// === Worker 主入口 ===
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return jsonResponse({});

    if (url.pathname === "/api/add-ssl" && request.method === "POST") return handleAddSSL(request);
    if (url.pathname === "/api/test" && request.method === "POST") return handleTestConnection(request);

    return new Response(getHTML(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};

// === HTML 页面 ===
function getHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Cloudflare SSL 一键启用</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { font-family:"Segoe UI",sans-serif;background:#f4f6fa;display:flex;justify-content:center;align-items:center;height:100vh; }
.box { background:#fff;padding:25px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:380px; }
h2 { text-align:center;color:#333;margin-bottom:20px; }
label { display:block;margin-top:10px;font-weight:bold;color:#555; }
input, select { width:100%;padding:10px;border:1px solid #ccc;border-radius:5px; }
button { width:100%;margin-top:15px;padding:10px;background:#0078d7;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:15px; }
button:hover { background:#005fa3; }
.result { margin-top:10px;padding:10px;border-radius:5px;text-align:center;font-size:14px; }
.success { background:#d4edda;color:#155724; }
.error { background:#f8d7da;color:#721c24; }
.progress { height:8px;background:#e9ecef;border-radius:5px;overflow:hidden;margin-top:8px; }
.bar { height:8px;background:#0078d7;width:0%;transition:width 0.4s; }
</style>
</head>
<body>
  <div class="box">
    <h2>一键启用 Cloudflare SSL</h2>

    <label>Cloudflare 邮箱</label>
    <input type="email" id="email" placeholder="输入 Cloudflare 邮箱">

    <label>Zone ID</label>
    <input type="text" id="zoneId" placeholder="输入 Zone ID">

    <label>API Key 或 Token</label>
    <input type="text" id="apiKey" placeholder="输入 Global Key 或 Token">

    <label>认证方式</label>
    <select id="mode">
      <option value="auto">自动识别</option>
      <option value="token">API Token</option>
      <option value="key">Global API Key</option>
    </select>

    <label>证书签发机构（CA）</label>
    <select id="ca">
      <option value="ssl_com">SSL.com（默认）</option>
      <option value="lets_encrypt">Let's Encrypt</option>
      <option value="digicert">DigiCert</option>
    </select>

    <button id="test">测试连接</button>
    <button id="submit">启用 SSL</button>

    <div class="progress"><div class="bar" id="bar"></div></div>
    <div id="result" class="result" style="display:none;"></div>
  </div>

<script>
const bar = document.getElementById("bar"), result = document.getElementById("result");

function updateProgress(p, msg, color="#0078d7") {
  bar.style.width = p + "%";
  bar.style.background = color;
  result.textContent = msg;
  result.style.display = "block";
  result.className = "result";
}

async function testConnection() {
  const email = document.getElementById("email").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const mode = document.getElementById("mode").value;

  if (!email || !apiKey) {
    alert("请输入邮箱和 API Key/Token");
    return;
  }

  updateProgress(20, "正在验证凭据...");

  try {
    const res = await fetch("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, apiKey, mode })
    });
    
    const data = await res.json();

    if (res.ok && data.success === true) {
      updateProgress(100, "✅ 连接成功！类型：" + (data.type || "未知").toUpperCase() + "，账户：" + (data.account || "未知"), "#28a745");
      result.classList.add("success");
    } else {
      updateProgress(100, "❌ 连接失败：" + (data.message || "未知错误"), "#dc3545");
      result.classList.add("error");
    }
  } catch (err) {
    updateProgress(100, "❌ 连接异常：" + err.message, "#dc3545");
    result.classList.add("error");
  }
}

async function enableSSL() {
  const email = document.getElementById("email").value.trim();
  const zoneId = document.getElementById("zoneId").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const mode = document.getElementById("mode").value;
  const ca = document.getElementById("ca").value;

  if (!email || !zoneId || !apiKey) {
    alert("请填写完整信息");
    return;
  }

  updateProgress(20, "正在启用 SSL...");

  try {
    const res = await fetch("/api/add-ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, zoneId, apiKey, mode, ca })
    });

    const data = await res.json();

    if (res.ok && data.success === true) {
      updateProgress(100, "✅ SSL 启用请求已发送！请稍后在 Cloudflare 控制台确认", "#28a745");
      result.classList.add("success");
    } else {
      updateProgress(100, "❌ 启用失败：" + (data.errors?.[0]?.message || data.message || "未知错误"), "#dc3545");
      result.classList.add("error");
    }
  } catch (err) {
    updateProgress(100, "❌ 启用异常：" + err.message, "#dc3545");
    result.classList.add("error");
  }
}

document.getElementById("test").onclick = testConnection;
document.getElementById("submit").onclick = enableSSL;
</script>
</body>
</html>
`;
}
