from flask import Flask, jsonify, request

app = Flask(__name__)
tasks = []
next_task_id = 1


def find_task(task_id):
    return next((task for task in tasks if task["id"] == task_id), None)


def json_error(message, status_code):
    return jsonify({"error": message}), status_code


@app.route("/")
def index():
    return "<h1>FocusKit Flask API is running</h1>"


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "focuskit-flask-server"})


@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    return jsonify(tasks)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    global next_task_id

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Request body must be a JSON object.", 400)

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        return json_error("Task title is required.", 400)

    completed = data.get("completed", False)
    if not isinstance(completed, bool):
        return json_error("Task completed must be true or false.", 400)

    task = {
        "id": next_task_id,
        "title": title.strip(),
        "completed": completed,
    }
    tasks.append(task)
    next_task_id += 1

    return jsonify(task), 201


@app.route("/api/tasks/<int:task_id>", methods=["GET"])
def get_task(task_id):
    task = find_task(task_id)
    if task is None:
        return json_error("Task not found.", 404)

    return jsonify(task)


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    task = find_task(task_id)
    if task is None:
        return json_error("Task not found.", 404)

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Request body must be a JSON object.", 400)

    has_update = False

    if "title" in data:
        title = data["title"]
        if not isinstance(title, str) or not title.strip():
            return json_error("Task title must be a non-empty string.", 400)
        task["title"] = title.strip()
        has_update = True

    if "completed" in data:
        completed = data["completed"]
        if not isinstance(completed, bool):
            return json_error("Task completed must be true or false.", 400)
        task["completed"] = completed
        has_update = True

    if not has_update:
        return json_error("Request body must include title or completed.", 400)

    return jsonify(task)


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = find_task(task_id)
    if task is None:
        return json_error("Task not found.", 404)

    tasks.remove(task)
    return jsonify({"deleted": True, "task": task})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
