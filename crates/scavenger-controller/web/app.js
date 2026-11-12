const state = {
  loading: true,
  snapshot: null,
};

const $ = (selector) => document.querySelector(selector);

function setConnection(label, status) {
  const node = $("#connection-state");
  node.dataset.state = status;
  node.querySelector("span:last-child").textContent = label;
}

function formatMemory(bytes) {
  if (!bytes) return "—";
  const gib = bytes / (1024 ** 3);
  return `${gib >= 1 ? gib.toFixed(1) : Math.round(bytes / (1024 ** 2))} ${gib >= 1 ? "GiB" : "MiB"}`;
}

function renderMetrics(snapshot) {
  const metrics = snapshot.metrics;
  $("#metric-queued").textContent = metrics.queued_tasks;
  $("#metric-running").textContent = metrics.running_tasks;
  $("#metric-succeeded").textContent = metrics.succeeded_tasks;
  $("#metric-agents").textContent = snapshot.agents.length;
}

function renderAgents(snapshot) {
  $("#agent-count").textContent = `${snapshot.agents.length} connected`;
  const list = $("#agent-list");
  if (!snapshot.agents.length) {
    list.innerHTML = '<p class="table-message">No Agent has enrolled yet.</p>';
    return;
  }
  list.innerHTML = snapshot.agents.map((agent) => {
    const device = agent.devices[0];
    const deviceText = device
      ? `<strong>${device.uuid}</strong><span>${formatMemory(device.free_memory_bytes)} free</span><span>${device.process_count} proc</span>`
      : '<span>No device inventory</span>';
    return `<div class="agent-row">
      <div><div class="agent-name">${escapeHtml(agent.agent_id)}</div><div class="agent-id">session ${agent.session_id}</div></div>
      <span class="health health-${agent.health}">${agent.health}</span>
      <div class="device-line">${deviceText}</div>
    </div>`;
  }).join("");
}

function renderTasks(snapshot) {
  const list = $("#task-list");
  if (!snapshot.tasks.length) {
    list.innerHTML = '<tr><td colspan="5" class="table-message">Queue is empty.</td></tr>';
    return;
  }
  list.innerHTML = snapshot.tasks.map((task) => `<tr>
    <td>${escapeHtml(task.task_id)}</td>
    <td><span class="status status-${task.status}">${task.status}</span></td>
    <td>${escapeHtml(task.device_uuid)}</td>
    <td>${task.lease_epoch}</td>
    <td>${escapeHtml(task.program)}</td>
  </tr>`).join("");
}

function render(snapshot) {
  state.snapshot = snapshot;
  renderMetrics(snapshot);
  renderAgents(snapshot);
  renderTasks(snapshot);
  setConnection("Controller live", "ready");
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    render(await response.json());
  } catch (error) {
    setConnection("Controller unavailable", "error");
    if (state.loading) {
      $("#agent-list").innerHTML = '<p class="table-message">Could not read controller state.</p>';
      $("#task-list").innerHTML = '<tr><td colspan="5" class="table-message">Retrying…</td></tr>';
    }
  } finally {
    state.loading = false;
  }
}

async function submitTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#form-message");
  const values = new FormData(form);
  const payload = {
    task_id: values.get("task_id"),
    device_uuid: values.get("device_uuid"),
    program: values.get("program"),
    args: String(values.get("args") || "").split("\n").map((line) => line.trim()).filter(Boolean),
    policy: values.get("policy"),
    checkpoint_path: values.get("checkpoint_path") || null,
  };
  message.className = "form-message";
  message.textContent = "Queueing…";
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "request failed");
    render(body);
    form.reset();
    message.textContent = "Task queued.";
  } catch (error) {
    message.className = "form-message is-error";
    message.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

$("#task-form").addEventListener("submit", submitTask);
$("#refresh-button").addEventListener("click", refresh);
refresh();
setInterval(refresh, 3000);
