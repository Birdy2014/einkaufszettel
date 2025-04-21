class TodoItemDialog {
    editable_attributes = [ "singular", "plural", "amount", "category" ]

    constructor() {
        this.element = document.getElementById("todo-item-dialog")
        this.form = document.querySelector("#todo-item-dialog > form")
        this.button_cancel = this.element.querySelector(".button-cancel")
        this.button_delete = this.element.querySelector(".button-delete")

        this.form.addEventListener("submit", _ => {
            for (const attribute_name of this.editable_attributes) {
                const element = this.element.querySelector(`#input-${attribute_name}`)
                this.todo_item.setAttribute(attribute_name, element.value.trim())
            }

            this.todo_item.send_update_request()
        })

        this.button_cancel.addEventListener("click", _ => {
            this.element.close()
        })

        this.button_delete.addEventListener("click", _ => {
            this.todo_item.setAttribute("deleted", "")
            this.element.close()

            this.todo_item.send_update_request()
        })
    }

    open(id) {
        this.todo_item = document.getElementById(id)
        if (!this.todo_item) {
            console.error(`No element with id ${id}`)
            return;
        }
        for (const attribute_name of this.editable_attributes) {
            const element = this.element.querySelector(`#input-${attribute_name}`)
            element.value = this.todo_item.getAttribute(attribute_name)
        }

        this.element.showModal()
    }
}

const todo_item_dialog = new TodoItemDialog()

class ListDialog {
    constructor() {
        this.element = document.getElementById("list-dialog")
        this.form = document.querySelector("#list-dialog > form")
        this.button_cancel = this.element.querySelector(".button-cancel")
        this.button_delete = this.element.querySelector(".button-delete")
        this.input_element = this.element.querySelector("#input-list-name")

        this.form.addEventListener("submit", _ => {
            this.#send_update_request(false)
        })

        this.button_cancel.addEventListener("click", _ => {
            this.element.close()
        })

        this.button_delete.addEventListener("click", _ => {
            if (!confirm(`Einkaufszettel '${shopping_list.name}' wirklich löschen?`)) {
                return
            }

            this.#send_update_request(true).then(_ => window.location = "/")
        })
    }

    open() {
        this.input_element.value = shopping_list.name

        this.element.showModal()
    }

    async #send_update_request(deleted) {
        const name = this.input_element.value

        await fetch(
            "/api/list",
            {
                method: "PUT",
                headers: { "Content-Type": "application/json", },
                cache: "no-cache",
                body: JSON.stringify({
                    id: shopping_list_id,
                    name,
                    deleted,
                }),
            }
        )

        setTimeout(_ => refresh_list_display(), 0)
    }
}

const list_dialog = new ListDialog()

class TodoItemGroupDialog {
    constructor() {
        this.element = document.getElementById("todo-item-group-dialog")
        this.form = document.querySelector("#todo-item-group-dialog > form")
        this.button_cancel = this.element.querySelector(".button-cancel")
        this.input_element = this.element.querySelector("#input-group-name")

        this.form.addEventListener("submit", _ => {
            this.#send_update_request(this.input_element.value)
        })

        this.button_cancel.addEventListener("click", _ => {
            this.element.close()
        })
    }

    open(name) {
        this.old_name = name
        this.input_element.value = name

        this.element.showModal()
    }

    async #send_update_request() {
        const new_name = this.input_element.value

        await fetch(
            "/api/category",
            {
                method: "PUT",
                headers: { "Content-Type": "application/json", },
                cache: "no-cache",
                body: JSON.stringify({
                    shopping_list_id,
                    old_name: this.old_name,
                    new_name,
                }),
            }
        )

        setTimeout(_ => refresh_list_display(), 0)
    }
}

const todo_item_group_dialog = new TodoItemGroupDialog()

class TodoItem extends HTMLElement {
    static observedAttributes = [ "singular", "plural", "amount", "category", "done" ]

    constructor() {
        super()

        const template = document.getElementById("template-todo-item")
        this.root = this.attachShadow({ mode: "open" })
        this.root.appendChild(template.content.cloneNode(true))

        this.root_element = this.root.getElementById("root-element")

        this.display_name = this.root.getElementById("display-name")
        this.display_amount = this.root.getElementById("display-amount")

        this.root_element.addEventListener("click", _ => {
            this.toggleAttribute("done")

            this.send_update_request()
        })

        this.root_element.addEventListener("contextmenu", event => {
            event.preventDefault()
            const id = this.get_id()
            if (id === undefined) {
                return
            }
            todo_item_dialog.open(id)
        })
    }

    get_id() {
        const item_id = parseInt(this.getAttribute("id"))
        if (isNaN(item_id)) {
            console.error(`Invalid item_id: ${this.getAttribute("id")}`)
            return
        }
        return item_id
    }

    async send_update_request() {
        if (!this.isConnected) {
            return
        }

        const item_id = this.get_id()
        if (item_id === undefined) {
            return
        }

        await fetch(
            "/api/item",
            {
                method: "PUT",
                headers: { "Content-Type": "application/json", },
                cache: "no-cache",
                body: JSON.stringify({
                    shopping_list_id,
                    item_id: item_id,
                    item: {
                        singular: this.getAttribute("singular"),
                        plural: this.getAttribute("plural"),
                        category: this.getAttribute("category"),
                        amount: parseInt(this.getAttribute("amount")) || 0,
                        done: this.getAttribute("done") !== null,
                        deleted: this.getAttribute("deleted") !== null,
                    },
                }),
            }
        )

        setTimeout(_ => refresh_list_display(), 0)
    }

    update_display() {
        const amount = parseInt(this.getAttribute("amount") || "0")

        if (amount === 1) {
            this.display_name.innerText = this.getAttribute("singular") || this.getAttribute("plural")
        } else {
            this.display_name.innerText = this.getAttribute("plural") || this.getAttribute("singular")
        }

        if (amount <= 0) {
            this.display_amount.innerText = ""
        } else {
            this.display_amount.innerText = amount.toString()
        }
    }

    attributeChangedCallback(name, _, new_value) {
        switch (name) {
            case "done": {
                const done = new_value !== null
                this.root_element.style.opacity = done ? 0.5 : 1
                break
            }
        }

        this.update_display()
    }
}

class TodoItemGroup extends HTMLElement {
    constructor() {
        super()

        const template = document.getElementById("template-todo-item-group")
        this.root = this.attachShadow({ mode: "open" })
        this.root.appendChild(template.content.cloneNode(true))
    }
}

document.getElementById("button-add-item").addEventListener("click", async _ => {
    await fetch(
        "/api/item",
        {
            method: "POST",
            headers: { "Content-Type": "application/json", },
            cache: "no-cache",
            body: JSON.stringify({
                shopping_list_id,
            }),
        }
    )
})

let shopping_list = { generation: -1, name: "", items: [], deleted: false }
let shopping_list_id = -1

function refresh_list_display() {
    document.getElementById("list-name").innerText = shopping_list.name

    const search_string = document.getElementById("searchbar").value
    const filter_re = new RegExp(search_string, "i")

    const new_list_todo = document.createElement("div")
    new_list_todo.classList = "list"
    new_list_todo.id = "list_todo"

    const new_list_done = document.createElement("div")
    new_list_done.classList = "list"
    new_list_done.id = "list_done"

    const compare_function = (a, b) => {
        if (a < b) {
            return -1
        }

        if (a > b) {
            return 1
        }

        return 0
    }

    const items = shopping_list.items
        .entries()
        .filter(([_id, item]) => !item.deleted)
        .filter(([_id, item]) =>
            filter_re.test(item.amount === 1 ? item.singular || item.plural : item.plural || item.singular)
            || filter_re.test(item.category))
        .toArray()

    const category_group_slots = items
        .map(([_id, value]) => ({ category: value.category, done: value.done, })) // Get categories
        .filter((value, _, array) => array.find(({category, done}) => value.category === category && value.done === done) === value) // Filter unique
        .sort((a, b) => compare_function(a.category, b.category))
        .map(({category, done}) => {
            const element = document.createElement("todo-item-group")
            const slot_name = document.createElement("div")
            const slot_content = document.createElement("div")

            element.append(slot_name)
            element.append(slot_content)

            const parent_list = done ? new_list_done : new_list_todo
            parent_list.append(element)

            slot_name.setAttribute("slot", "name")
            slot_name.innerText = category || "Ohne Kategorie"
            slot_name.addEventListener("contextmenu", event => {
                event.preventDefault()
                todo_item_group_dialog.open(category)
            })

            slot_content.setAttribute("slot", "content")
            return { category, done, slot_content }
        })

    for (const [id, item] of items.sort(([_a_id, a_item], [_b_id, b_item]) => compare_function(a_item.singular || a_item.plural, b_item.singular || b_item.plural))) {
        let new_todo = list_container.querySelector(`[id="${id}"]`)
        if (!new_todo) {
            new_todo = document.createElement("todo-item")
        }

        new_todo.setAttribute("id", id)
        new_todo.setAttribute("singular", item.singular)
        new_todo.setAttribute("plural", item.plural)
        new_todo.setAttribute("amount", item.amount)
        new_todo.setAttribute("category", item.category)

        if (item.done) {
            new_todo.setAttribute("done", "")
        } else {
            new_todo.removeAttribute("done")
        }

        const { slot_content } = category_group_slots.find(({ category, done }) => item.category === category && item.done === done)
        slot_content.append(new_todo)
    }

    list_container.replaceChild(new_list_todo, list_todo)
    list_container.replaceChild(new_list_done, list_done)
}

const long_polling_timeout = 10000
const error_wait_time = 4000

async function reload_list_from_server() {
    const error_message_element = document.getElementById("server-error-message")
    const error_message_timeout = setTimeout(_ => error_message_element.style.display = "none", 500)

    const start_time = Date.now()

    let response
    try {
        response = await fetch(`/api/list?id=${shopping_list_id}&generation=${shopping_list.generation}`, {
            method: "POST",
            signal: AbortSignal.timeout(long_polling_timeout),
            cache: "no-cache",
        })
    } catch(error) {
        const time_to_fail = Date.now() - start_time

        if (error instanceof DOMException && error.name == "TimeoutError") {
            if (time_to_fail > long_polling_timeout / 2) {
                return
            }

            console.log(`long polling failed with timeout after ${time_to_fail}ms`)
        }

        console.log(error)
        clearTimeout(error_message_timeout)
        error_message_element.style.removeProperty("display")

        await new Promise(resolve => setTimeout(resolve, error_wait_time))
        return
    }

    if (!response.ok) {
        console.log("not ok")
        clearTimeout(error_message_timeout)
        error_message_element.style.removeProperty("display")

        await new Promise(resolve => setTimeout(resolve, error_wait_time))
        return
    }

    shopping_list = await response.json()

    refresh_list_display()
}

const list_selector_container = document.getElementById("list-selector-container")

async function init_list() {
    list_selector_container.style.display = "none"
    list_container.style.removeProperty("display")

    customElements.define("todo-item", TodoItem)
    customElements.define("todo-item-group", TodoItemGroup)

    document.getElementById("server-error-message").style.display = "none"

    document.getElementById("searchbar").addEventListener("input", _ => {
        refresh_list_display()
    })

    document.getElementById("list-name").addEventListener("contextmenu", event => {
        event.preventDefault()
        list_dialog.open()
    })

    while (true) {
        await reload_list_from_server()
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

async function init() {
    const params = new URLSearchParams(location.search)
    const list_id = parseInt(params.get("list_id"))

    if (!isNaN(list_id)) {
        shopping_list_id = list_id
        init_list()
        return
    }

    const response = await fetch("/api/lists")
    const lists = await response.json()

    const list_selector_list = document.getElementById("list-selector-list")

    list_selector_list.replaceChildren(...lists.entries().filter(([_id, list]) => !list.deleted).map(([id, list]) => {
        const element = document.createElement("a")
        element.href = `/?list_id=${id}`
        element.innerText = list.name
        element.classList = "list-select-item"
        return element
    }))

    const button_add_list = document.getElementById("button-add-list")
    button_add_list.addEventListener("click", _ => {
        fetch(
            "/api/lists",
            {
                method: "POST",
                headers: { "Content-Type": "application/json", },
                cache: "no-cache",
            }
        ).then(_ => location.reload())
    })

    list_selector_container.style.removeProperty("display")
    list_container.style.display = "none"
}

init()
