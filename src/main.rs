use std::{fs, sync::Arc};

use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use tokio::sync::broadcast;

#[derive(Clone, Serialize, Deserialize)]
struct ShoppingListItem {
    singular: String,
    plural: String,
    category: String,
    amount: i32,
    done: bool,
    deleted: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct ShoppingList {
    generation: i32,
    name: String,
    items: Vec<ShoppingListItem>,
    deleted: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct Data {
    shopping_lists: Vec<ShoppingList>,
}

struct AppState {
    save_path: String,
    data: RwLock<Data>,
    change_block_channel_sender: broadcast::Sender<()>,
}

async fn get_root() -> Html<&'static str> {
    Html(include_str!("../client/index.html"))
}

async fn get_static(extract::Path(filename): extract::Path<String>) -> impl IntoResponse {
    let (status, content_type, content) = match filename.as_str() {
        "index.css" => (
            StatusCode::OK,
            "text/css",
            include_str!("../client/index.css"),
        ),
        "index.js" => (
            StatusCode::OK,
            "application/javascript",
            include_str!("../client/index.js"),
        ),
        "manifest.json" => (
            StatusCode::OK,
            "application/json",
            include_str!("../client/manifest.json"),
        ),
        "todo-item.css" => (
            StatusCode::OK,
            "text/css",
            include_str!("../client/todo-item.css"),
        ),
        _ => (StatusCode::NOT_FOUND, "", ""),
    };
    (
        status,
        [(axum::http::header::CONTENT_TYPE, content_type)],
        content,
    )
}

#[derive(Serialize)]
struct ResponseBodyGetApiLists {
    name: String,
    deleted: bool,
}

async fn get_api_lists(State(state): State<Arc<AppState>>) -> Json<Vec<ResponseBodyGetApiLists>> {
    let data = state.data.read().unwrap();

    Json(
        data.shopping_lists
            .iter()
            .map(|list| ResponseBodyGetApiLists {
                name: list.name.to_string(),
                deleted: list.deleted,
            })
            .collect(),
    )
}

#[derive(Deserialize)]
struct RequestBodyPutApiList {
    id: usize,
    name: String,
    deleted: bool,
}

async fn put_api_list(
    State(state): State<Arc<AppState>>,
    extract::Json(payload): extract::Json<RequestBodyPutApiList>,
) -> StatusCode {
    let mut data = state.data.write().unwrap();

    if payload.id >= data.shopping_lists.len() {
        return StatusCode::BAD_REQUEST;
    }

    let list = &mut data.shopping_lists[payload.id];
    list.name = payload.name;
    list.deleted = payload.deleted;

    handle_data_change(
        state.save_path.as_str(),
        &state.change_block_channel_sender,
        &mut data,
        payload.id,
    );

    StatusCode::OK
}

#[derive(Deserialize)]
struct RequestQueryGetList {
    id: usize,
    generation: i32,
}

// This has to be POST, because firefox behaves really weirdly when using GET requests for long
// polling from two separate tabs in the same instance.
async fn post_api_list(
    State(state): State<Arc<AppState>>,
    query: extract::Query<RequestQueryGetList>,
) -> Result<Json<ShoppingList>, StatusCode> {
    let current_generation = {
        let data = state.data.read().unwrap();

        if query.id >= data.shopping_lists.len() {
            return Err(StatusCode::BAD_REQUEST);
        }

        data.shopping_lists[query.id].generation
    };

    if query.generation == current_generation {
        let mut receiver = state.change_block_channel_sender.subscribe();
        let _ = receiver.recv().await;
    }

    let data = state.data.read().unwrap();

    // Why do I have to clone here? Can Json not accept a borrowed value?
    Ok(Json(data.shopping_lists[query.id].clone()))
}

#[derive(Deserialize)]
struct RequestBodyPostApiItem {
    shopping_list_id: usize,
}

#[derive(Deserialize)]
struct RequestBodyPutApiItem {
    item: ShoppingListItem,
    shopping_list_id: usize,
    item_id: usize,
}

async fn post_api_item(
    State(state): State<Arc<AppState>>,
    extract::Json(payload): extract::Json<RequestBodyPostApiItem>,
) -> (StatusCode, String) {
    let mut data = state.data.write().unwrap();

    if payload.shopping_list_id >= data.shopping_lists.len() {
        return (StatusCode::BAD_REQUEST, "".to_string());
    }

    let new_item = ShoppingListItem {
        singular: "".to_string(),
        plural: "".to_string(),
        category: "".to_string(),
        amount: 0,
        done: false,
        deleted: false,
    };

    let items = &mut data.shopping_lists[payload.shopping_list_id].items;

    let reused_item_id =
        items.iter().enumerate().find_map(
            |(index, item)| {
                if item.deleted {
                    Some(index)
                } else {
                    None
                }
            },
        );

    let item_id = match reused_item_id {
        Some(id) => {
            items[id] = new_item;
            id
        }
        None => {
            items.push(new_item);
            items.len()
        }
    };

    handle_data_change(
        state.save_path.as_str(),
        &state.change_block_channel_sender,
        &mut data,
        payload.shopping_list_id,
    );

    (StatusCode::OK, item_id.to_string())
}

async fn put_api_item(
    State(state): State<Arc<AppState>>,
    extract::Json(payload): extract::Json<RequestBodyPutApiItem>,
) -> StatusCode {
    let mut data = state.data.write().unwrap();

    if payload.shopping_list_id >= data.shopping_lists.len()
        || payload.item_id >= data.shopping_lists[payload.shopping_list_id].items.len()
    {
        return StatusCode::BAD_REQUEST;
    }

    data.shopping_lists[payload.shopping_list_id].items[payload.item_id] = payload.item;

    handle_data_change(
        state.save_path.as_str(),
        &state.change_block_channel_sender,
        &mut data,
        payload.shopping_list_id,
    );

    StatusCode::OK
}

#[derive(Deserialize)]
struct RequestBodyPutApiCategory {
    shopping_list_id: usize,
    old_name: String,
    new_name: String,
}

async fn put_api_category(
    State(state): State<Arc<AppState>>,
    extract::Json(payload): extract::Json<RequestBodyPutApiCategory>,
) -> StatusCode {
    let mut data = state.data.write().unwrap();

    if payload.shopping_list_id >= data.shopping_lists.len() {
        return StatusCode::BAD_REQUEST;
    }

    data.shopping_lists[payload.shopping_list_id]
        .items
        .iter_mut()
        .filter(|item| item.category == payload.old_name)
        .for_each(|item| {
            item.category = payload.new_name.clone();
        });

    handle_data_change(
        state.save_path.as_str(),
        &state.change_block_channel_sender,
        &mut data,
        payload.shopping_list_id,
    );

    StatusCode::OK
}

fn handle_data_change(
    save_path: &str,
    sender: &broadcast::Sender<()>,
    data: &mut Data,
    changed_list_id: usize,
) {
    data.shopping_lists[changed_list_id].generation += 1;
    let _ = sender.send(());
    let data_string = serde_json::to_string(data).expect("Failed to serialize data");
    fs::write(save_path, data_string).expect("Failed to write file");
}

#[tokio::main]
async fn main() {
    if std::env::args().len() != 3 {
        eprintln!("Usage: einkaufszettel <listen address> <save file path>");
        return;
    }

    let address = std::env::args().nth(1).unwrap();
    let path = std::env::args().nth(2).unwrap();

    let data = match fs::read_to_string(path.as_str()) {
        Ok(file) => serde_json::from_str(file.as_str()).unwrap(),
        Err(_) => Data {
            shopping_lists: vec![ShoppingList {
                generation: 0,
                name: "Default - TODO".to_string(),
                items: vec![],
                deleted: false,
            }],
        },
    };

    let (tx, _) = broadcast::channel(1);

    let shared_state = Arc::new(AppState {
        save_path: path,
        data: RwLock::new(data),
        change_block_channel_sender: tx,
    });

    let app = Router::new()
        .route("/", get(get_root))
        .route("/client/:filename", get(get_static))
        .route("/api/lists", get(get_api_lists))
        .route("/api/list", put(put_api_list))
        .route("/api/list", post(post_api_list))
        .route("/api/item", post(post_api_item))
        .route("/api/item", put(put_api_item))
        .route("/api/category", put(put_api_category))
        .with_state(shared_state);

    println!("Listening on {}", address);
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
