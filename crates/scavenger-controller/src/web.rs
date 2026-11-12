use std::net::SocketAddr;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use crate::server::{ControllerService, ControllerSnapshot};
use crate::store::{EnqueueOptions, EnqueueTask};

#[derive(Clone)]
struct WebState {
    service: ControllerService,
}

#[derive(Debug, Deserialize)]
struct CreateTaskRequest {
    task_id: String,
    device_uuid: String,
    program: String,
    #[serde(default)]
    args: Vec<String>,
    workdir: Option<String>,
    output_path: Option<String>,
    policy: Option<String>,
    checkpoint_path: Option<String>,
    checkpoint_deadline_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

pub async fn serve(
    service: ControllerService,
    address: SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(address).await?;
    serve_with_listener(service, listener).await
}

pub async fn serve_with_listener(
    service: ControllerService,
    listener: TcpListener,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = WebState { service };
    let app = Router::new()
        .route("/", get(index))
        .route("/styles.css", get(styles))
        .route("/app.js", get(script))
        .route("/api/status", get(status))
        .route("/api/tasks", post(create_task))
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../web/index.html"))
}

async fn styles() -> impl IntoResponse {
    (
        [("content-type", "text/css; charset=utf-8")],
        include_str!("../web/styles.css"),
    )
}

async fn script() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        include_str!("../web/app.js"),
    )
}

async fn status(
    State(state): State<WebState>,
) -> Result<Json<ControllerSnapshot>, (StatusCode, Json<ErrorBody>)> {
    state
        .service
        .snapshot()
        .map(Json)
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))
}

async fn create_task(
    State(state): State<WebState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<ControllerSnapshot>), (StatusCode, Json<ErrorBody>)> {
    validate_request(&request)?;
    let policy = request.policy.as_deref().unwrap_or("stateless");
    let options = match policy {
        "stateless" => EnqueueOptions::default(),
        "checkpointed" => EnqueueOptions {
            policy: 1,
            checkpoint_path: request.checkpoint_path.clone(),
            checkpoint_deadline_ms: request.checkpoint_deadline_ms.unwrap_or(30_000),
        },
        _ => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "unknown task policy".to_string(),
            ))
        }
    };
    state
        .service
        .enqueue_task(EnqueueTask {
            task_id: request.task_id,
            device_uuid: request.device_uuid,
            program: request.program,
            args: request.args,
            workdir: request.workdir,
            output_path: request.output_path,
            options,
        })
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
    let snapshot = state
        .service
        .snapshot()
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((StatusCode::CREATED, Json(snapshot)))
}

fn validate_request(request: &CreateTaskRequest) -> Result<(), (StatusCode, Json<ErrorBody>)> {
    if request.task_id.is_empty()
        || request.task_id.len() > 128
        || request.device_uuid.is_empty()
        || request.program.is_empty()
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "task_id, device_uuid and program are required and bounded".to_string(),
        ));
    }
    if request.args.len() > 64 {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "at most 64 task arguments are accepted".to_string(),
        ));
    }
    Ok(())
}

fn api_error(status: StatusCode, message: String) -> (StatusCode, Json<ErrorBody>) {
    (status, Json(ErrorBody { error: message }))
}
