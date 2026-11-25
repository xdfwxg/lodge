//! SSE：hello + 回放 + 实时，按 seq 去重。

use std::sync::Arc;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, Sse};

use crate::state::App;

pub async fn stream(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    app.events.clone().sse(headers)
}
