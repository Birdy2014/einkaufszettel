class TodoItem extends HTMLElement {
    static observedAttributes = [ "singular", "plural", "amount", "category", "done" ]

    editable_attributes = [ "singular", "plural", "amount", "category" ]

    constructor() {
        super()

        const template = document.getElementById("template-todo-item")
        this.root = this.attachShadow({ mode: "open" })
        this.root.appendChild(template.content.cloneNode(true))

        this.root_element = this.root.getElementById("root-element")
        this.dialog = this.root.getElementById("dialog")
        this.form = this.root.querySelector("#dialog > form")
        this.button_cancel = this.root.getElementById("button-cancel")
        this.button_delete = this.root.getElementById("button-delete")

        this.display_name = this.root.getElementById("display-name")
        this.display_amount = this.root.getElementById("display-amount")

        this.root_element.addEventListener("click", _ => {
            this.toggleAttribute("done")

            this.send_update_request()
        })

        this.root_element.addEventListener("contextmenu", event => {
            event.preventDefault()

            for (const attribute_name of this.editable_attributes) {
                const element = this.root.getElementById(`input-${attribute_name}`)
                element.value = this.getAttribute(attribute_name)
            }

            this.dialog.showModal()
        })

        this.form.addEventListener("submit", _ => {
            for (const attribute_name of this.editable_attributes) {
                const element = this.root.getElementById(`input-${attribute_name}`)
                this.setAttribute(attribute_name, element.value.trim())
            }

            this.send_update_request()
        })

        this.button_cancel.addEventListener("click", _ => {
            this.dialog.close()
        })

        this.button_delete.addEventListener("click", _ => {
            this.setAttribute("deleted", "")

            this.send_update_request()
        })
    }

    async send_update_request() {
        if (!this.isConnected) {
            return
        }

        const item_id = parseInt(this.getAttribute("id"))
        if (isNaN(item_id)) {
            console.error(`Invalid item_id: ${this.getAttribute("id")}`)
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

button_add.addEventListener("click", async _ => {
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

let shopping_list = { generation: -1, name: "", items: [], }
let shopping_list_id = -1

function refresh_list_display() {
    // When a dialog element with an open modal is removed from the dom, the modal is closed.
    // To prevent this from happening when another user edits the list, create new elements for the lists
    // and reuse as many elements as possible.

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

async function init_list() {
    list_selector.style.display = "none"
    list_container.style.removeProperty("display")

    customElements.define("todo-item", TodoItem)
    customElements.define("todo-item-group", TodoItemGroup)

    document.getElementById("server-error-message").style.display = "none"

    document.getElementById("searchbar").addEventListener("input", _ => {
        refresh_list_display()
    })

    while (true) {
        await reload_list_from_server()
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

// TODO: Allow creation and renaming of lists

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

    list_selector.replaceChildren(...lists.entries().map(([id, name]) => {
        const element = document.createElement("a")
        element.href = `/?list_id=${id}`
        element.innerText = name
        element.classList = "list-select-item"
        return element
    }))

    list_selector.style.removeProperty("display")
    list_container.style.display = "none"
}

init()
