# College Computer Lab Web-OS

## Setup
```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
flask --app app init-db        # creates labos.db + seeds demo accounts
python app.py                  # http://127.0.0.1:5000
```
Logins: `admin / admin123` (Admin panel at /admin) and `student / student123`. **Change both immediately.**

Compilers needed on the server for the Code Editor: `python3`, `gcc`, `g++`, and a JDK (`javac`/`java`).
Set `SECRET_KEY` and optionally `DATABASE_URL` (e.g. `postgresql://user:pw@host/db`, plus `pip install psycopg2-binary`).

## Before real lab use
- **Sandbox code execution.** executor.py is NOT a sandbox. Replace `_run` with `docker run --rm --network none --memory 256m --cpus 0.5 ...`.
- Add CSRF protection (Flask-WTF) and run behind gunicorn + HTTPS.
- Host Quill/Handsontable/Monaco locally if lab machines are offline (CDN links are in templates/index.html).
