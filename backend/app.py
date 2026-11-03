import os
from io import BytesIO
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from psycopg import connect
from psycopg.rows import dict_row
from pwdlib import PasswordHash
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import PatternFill, Font, Border, Side, Alignment

app = FastAPI(
    title="Sangil Production",
    version="1.0.0"
)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required")

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 480

password_hash = PasswordHash.recommended()
security = HTTPBearer()


def get_db():
    return connect(DATABASE_URL, row_factory=dict_row)


def init_database():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                full_name VARCHAR(200) NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(30) NOT NULL
                    CHECK (role IN (
                        'SUPER_ADMIN', 'ADMIN', 'MANAGER_PRODUCTION', 'OPERATOR', 'VIEWER'
                    )),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS production_checksheets (
                id BIGSERIAL PRIMARY KEY,
                effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
                machine_name VARCHAR(200) NOT NULL DEFAULT 'Legacy / Tidak diketahui',
                shift VARCHAR(30) NOT NULL,
                operator_name VARCHAR(200) NOT NULL,
                pic_operator VARCHAR(200) NOT NULL DEFAULT '',
                created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.execute("ALTER TABLE production_checksheets ADD COLUMN IF NOT EXISTS machine_name VARCHAR(200) NOT NULL DEFAULT 'Legacy / Tidak diketahui'")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS production_check_items (
                id BIGSERIAL PRIMARY KEY,
                checksheet_id BIGINT NOT NULL REFERENCES production_checksheets(id) ON DELETE CASCADE,
                item_no INTEGER NOT NULL,
                item_check VARCHAR(200) NOT NULL,
                condition VARCHAR(200) NOT NULL,
                machine_condition VARCHAR(10) NOT NULL CHECK (machine_condition IN ('RUN', 'STOP')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                username VARCHAR(100),
                action VARCHAR(100) NOT NULL,
                description TEXT,
                ip_address VARCHAR(100),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS excel_dashboard_uploads (
                id BIGSERIAL PRIMARY KEY,
                file_name VARCHAR(255) NOT NULL,
                period_start DATE,
                uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                total_rows INTEGER NOT NULL DEFAULT 0
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS excel_dashboard_rows (
                id BIGSERIAL PRIMARY KEY,
                upload_id BIGINT NOT NULL REFERENCES excel_dashboard_uploads(id) ON DELETE CASCADE,
                area VARCHAR(100) NOT NULL,
                inspection_date DATE NOT NULL,
                target_eff DOUBLE PRECISION,
                actual_eff DOUBLE PRECISION,
                acc_eff DOUBLE PRECISION,
                loaded_time DOUBLE PRECISION,
                UNIQUE(upload_id, area, inspection_date)
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_excel_dashboard_rows_date
            ON excel_dashboard_rows(inspection_date, area)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS excel_dashboard_operator_rows (
                id BIGSERIAL PRIMARY KEY,
                area VARCHAR(100) NOT NULL,
                inspection_date DATE NOT NULL,
                target_eff DOUBLE PRECISION NOT NULL,
                actual_eff DOUBLE PRECISION,
                acc_eff DOUBLE PRECISION,
                loaded_time DOUBLE PRECISION NOT NULL,
                good_quantity DOUBLE PRECISION,
                created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_excel_dashboard_operator_date
            ON excel_dashboard_operator_rows(inspection_date, area)
        """)
        conn.commit()


@app.on_event("startup")
def startup():
    init_database()


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    full_name: str
    password: str
    role: str


class UpdateUserRequest(BaseModel):
    full_name: str
    role: str
    is_active: bool


class ResetPasswordRequest(BaseModel):
    password: str

class SetupSuperAdminRequest(BaseModel):
    username: str
    full_name: str
    password: str



class OperatorEfficiencyRequest(BaseModel):
    inspection_date: str
    area: str
    target_eff: float
    total_working_time: float
    good_quantity: float


def create_token(user):
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=JWT_EXPIRE_MINUTES)

    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "iat": now,
        "exp": expire
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM]
        )

        user_id = payload.get("sub")

        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Token tidak valid"
            )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token sudah expired"
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Token tidak valid"
        )

    with get_db() as conn:
        user = conn.execute(
            """
            SELECT id, username, full_name, role, is_active
            FROM users
            WHERE id = %s
            """,
            (int(user_id),)
        ).fetchone()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User tidak ditemukan"
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=403,
            detail="User tidak aktif"
        )

    return user


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "application": "Sangil Production"
    }


@app.get("/api/health/database")
def database_health():
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT
                current_database() AS database,
                NOW() AS server_time
            """
        ).fetchone()

    return {
        "status": "ok",
        "database": row["database"],
        "server_time": row["server_time"]
    }


@app.post("/api/admin/setup-superadmin")
def setup_superadmin(data: SetupSuperAdminRequest):
    with get_db() as conn:
        existing = conn.execute(
            """
            SELECT COUNT(*) AS total
            FROM users
            WHERE role = 'SUPER_ADMIN'
            """
        ).fetchone()

        if existing["total"] > 0:
            raise HTTPException(
                status_code=409,
                detail="SUPER_ADMIN sudah ada"
            )

        existing_username = conn.execute(
            """
            SELECT id
            FROM users
            WHERE username = %s
            """,
            (data.username,)
        ).fetchone()

        if existing_username:
            raise HTTPException(
                status_code=409,
                detail="Username sudah digunakan"
            )

        hashed_password = password_hash.hash(data.password)

        user = conn.execute(
            """
            INSERT INTO users
            (
                username,
                full_name,
                password_hash,
                role,
                is_active
            )
            VALUES (%s, %s, %s, 'SUPER_ADMIN', TRUE)
            RETURNING id, username, full_name, role
            """,
            (
                data.username,
                data.full_name,
                hashed_password
            )
        ).fetchone()

        conn.execute(
            """
            INSERT INTO audit_logs
            (
                user_id,
                username,
                action,
                description
            )
            VALUES (%s, %s, %s, %s)
            """,
            (
                user["id"],
                user["username"],
                "CREATE_SUPER_ADMIN",
                "Super Admin pertama dibuat"
            )
        )

        conn.commit()

    return {
        "status": "ok",
        "message": "SUPER_ADMIN berhasil dibuat",
        "user": user
    }


@app.post("/api/auth/login")
def login(data: LoginRequest):
    with get_db() as conn:
        user = conn.execute(
            """
            SELECT
                id,
                username,
                full_name,
                password_hash,
                role,
                is_active
            FROM users
            WHERE username = %s
            """,
            (data.username,)
        ).fetchone()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Username atau password salah"
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=403,
            detail="User tidak aktif"
        )

    if not password_hash.verify(
        data.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Username atau password salah"
        )

    token = create_token(user)

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO audit_logs
            (
                user_id,
                username,
                action,
                description
            )
            VALUES (%s, %s, %s, %s)
            """,
            (
                user["id"],
                user["username"],
                "LOGIN",
                "User berhasil login"
            )
        )
        conn.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "full_name": user["full_name"],
            "role": user["role"]
        }
    }


@app.get("/api/users")
def list_users(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Akses hanya untuk SUPER_ADMIN")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, username, full_name, role, is_active, created_at, updated_at
                FROM users
                ORDER BY id
            """)
            return {"users": cur.fetchall()}


@app.post("/api/users")
def create_user(
    request: CreateUserRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Akses hanya untuk SUPER_ADMIN")

    allowed_roles = {
        "ADMIN",
        "MANAGER_PRODUCTION",
        "OPERATOR",
        "VIEWER"
    }

    if request.role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Role tidak valid")

    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM users WHERE username = %s",
                (request.username,)
            )

            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Username sudah digunakan")

            hashed_password = password_hash.hash(request.password)

            cur.execute("""
                INSERT INTO users
                (username, full_name, password_hash, role, is_active)
                VALUES (%s, %s, %s, %s, TRUE)
                RETURNING id, username, full_name, role, is_active, created_at, updated_at
            """, (
                request.username,
                request.full_name,
                hashed_password,
                request.role
            ))

            user = cur.fetchone()

            cur.execute("""
                INSERT INTO audit_logs
                (user_id, username, action, description)
                VALUES (%s, %s, 'CREATE_USER', %s)
            """, (
                current_user["id"],
                current_user["username"],
                "Membuat user: " + request.username + " dengan role " + request.role
            ))

            conn.commit()

            return user


@app.put("/api/users/{user_id}")
def update_user(
    user_id: int,
    request: UpdateUserRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Akses hanya untuk SUPER_ADMIN")

    allowed_roles = {
        "ADMIN",
        "MANAGER_PRODUCTION",
        "OPERATOR",
        "VIEWER"
    }

    if request.role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Role tidak valid")

    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=400,
            detail="SUPER_ADMIN tidak dapat mengubah akun sendiri"
        )

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE users
                SET full_name = %s,
                    role = %s,
                    is_active = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id, username, full_name, role, is_active, created_at, updated_at
            """, (
                request.full_name,
                request.role,
                request.is_active,
                user_id
            ))

            user = cur.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User tidak ditemukan")

            cur.execute("""
                INSERT INTO audit_logs
                (user_id, username, action, description)
                VALUES (%s, %s, 'UPDATE_USER', %s)
            """, (
                current_user["id"],
                current_user["username"],
                "Mengubah user ID " + str(user_id)
            ))

            conn.commit()

            return user


@app.post("/api/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    request: ResetPasswordRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Akses hanya untuk SUPER_ADMIN")

    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=400,
            detail="Gunakan mekanisme perubahan password sendiri"
        )

    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")

    hashed_password = password_hash.hash(request.password)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE users
                SET password_hash = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id, username, full_name, role, is_active
            """, (
                hashed_password,
                user_id
            ))

            user = cur.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User tidak ditemukan")

            cur.execute("""
                INSERT INTO audit_logs
                (user_id, username, action, description)
                VALUES (%s, %s, 'RESET_PASSWORD', %s)
            """, (
                current_user["id"],
                current_user["username"],
                "Reset password user ID " + str(user_id)
            ))

            conn.commit()

            return user


@app.delete("/api/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Akses hanya untuk SUPER_ADMIN")

    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=400,
            detail="SUPER_ADMIN tidak dapat menghapus akun sendiri"
        )

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username FROM users WHERE id = %s",
                (user_id,)
            )

            target = cur.fetchone()

            if not target:
                raise HTTPException(status_code=404, detail="User tidak ditemukan")

            cur.execute(
                "DELETE FROM users WHERE id = %s",
                (user_id,)
            )

            cur.execute("""
                INSERT INTO audit_logs
                (user_id, username, action, description)
                VALUES (%s, %s, 'DELETE_USER', %s)
            """, (
                current_user["id"],
                current_user["username"],
                "Menghapus user: " + target["username"]
            ))

            conn.commit()

            return {
                "message": "User berhasil dihapus"
            }

@app.get("/api/me")
def me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"]
    }

# ============================================================
# PRODUCTION CHECKSHEET
# ============================================================

class ProductionCheckItem(BaseModel):
    item_check: str
    condition: str
    actual_inspec: str = ""
    status: str = "OK"
    machine_condition: str = "RUN"
    remarks: str = ""


class ProductionChecksheetRequest(BaseModel):
    machine_name: str = "Legacy / Tidak diketahui"
    shift: str = ""
    operator_name: str
    pic_operator: str = ""
    checks: list[ProductionCheckItem]



@app.get("/api/production/checksheets")
def list_production_checksheets(
    current_user: dict = Depends(get_current_user)
):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                pc.id,
                pc.effective_date,
                pc.machine_name,
                pc.shift,
                pc.operator_name,
                pc.pic_operator,
                pc.created_at,
                pci.item_no,
                pci.item_check,
                pci.condition,
                pci.machine_condition,
                pci.actual_inspec,
                pci.status,
                pci.remarks
            FROM production_checksheets pc
            LEFT JOIN production_check_items pci
                ON pci.checksheet_id = pc.id
            ORDER BY
                pc.id DESC,
                pci.item_no ASC
        """).fetchall()

    return {"checksheets": [dict(row) for row in rows]}




# ============================================================
# NOTIFIKASI CHECKSHEET HARIAN - WIB
# Khusus SUPER_ADMIN dan MANAGER_PRODUCTION
# ============================================================

PRODUCTION_ALERT_MACHINES = [
    'Soldering',
    'Cutting Pipe Condenser',
    'Cutting Pipe Hotline',
    'Cutting Copper Tube',
    'Cutting & Notching',
    'Bending Auto Condensor Pipe',
    '300T-01',
    '300T-02',
    '400T-01',
    '400T-02',
    '400T-03',
    '400T-04',
    '250T-A01',
    '250T-A02',
    '250T-A03',
    '250T-A04',
    '250T-A05',
    '250T-A06',
    '250T-B01',
    '250T-B02',
    '250T-B03',
    '250T-B04',
    '250T-C01',
    '80T-01',
    'Spot Welding Siku Reinforce',
    'Spot Welding Hinge Part',
    'Spot Welding Nut Reinforce',
    'Spot Welding Reinforce R',
    'Spot Welding Reinforce L',
    'Spot Nut Hinge Upper',
    'Spot Nut Hinge Center',
    '45T-01',
    '40T-01',
    '45T-02', 'Spot Welding Base Compresor',
]


@app.get("/api/production/missing-checksheets")
def get_missing_production_checksheets(
    current_user: dict = Depends(get_current_user)
):
    allowed_roles = {"SUPER_ADMIN", "MANAGER_PRODUCTION"}

    if current_user["role"] not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail="Notifikasi checksheet hanya untuk SUPER_ADMIN dan MANAGER_PRODUCTION"
        )

    now_wib = datetime.now(ZoneInfo("Asia/Jakarta"))
    today_wib = now_wib.date()

    # Senin-Jumat saja, mulai pukul 09.00 WIB.
    if now_wib.weekday() >= 5 or now_wib.hour < 9:
        return {
            "active": False,
            "date": today_wib.isoformat(),
            "checked_at": now_wib.strftime("%H:%M:%S"),
            "missing_machines": [],
            "submitted_machines": [],
            "message": "Pemantauan aktif pada hari kerja mulai pukul 09.00 WIB."
        }

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT machine_name
            FROM production_checksheets
            WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = %s
              AND machine_name = ANY(%s)
            """,
            (today_wib, PRODUCTION_ALERT_MACHINES)
        ).fetchall()

    submitted = {row["machine_name"] for row in rows}
    submitted_ordered = [
        machine for machine in PRODUCTION_ALERT_MACHINES
        if machine in submitted
    ]
    missing = [
        machine for machine in PRODUCTION_ALERT_MACHINES
        if machine not in submitted
    ]

    return {
        "active": True,
        "date": today_wib.isoformat(),
        "checked_at": now_wib.strftime("%H:%M:%S"),
        "total_machines": len(PRODUCTION_ALERT_MACHINES),
        "submitted_count": len(submitted_ordered),
        "missing_count": len(missing),
        "missing_machines": missing,
        "submitted_machines": submitted_ordered,
        "message": (
            "Masih ada mesin yang belum mengisi checksheet."
            if missing else
            "Semua mesin sudah mengisi checksheet hari ini."
        )
    }
@app.get("/api/public/production/checksheets")
def list_public_production_checksheets():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT pc.id, pc.effective_date, pc.machine_name,
                   pc.shift, pc.operator_name, pc.pic_operator,
                   pc.created_at, pci.item_no, pci.item_check,
                   pci.condition, pci.machine_condition,
                   pci.actual_inspec, pci.status, pci.remarks
            FROM production_checksheets pc
            LEFT JOIN production_check_items pci
                ON pci.checksheet_id = pc.id
            ORDER BY pc.id DESC, pci.item_no ASC
        """).fetchall()
    return {"checksheets": [dict(row) for row in rows]}


@app.get("/api/production/checksheets/download")
def download_production_checksheets(
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] == "OPERATOR":
        raise HTTPException(
            status_code=403,
            detail="Operator tidak memiliki akses untuk download Excel."
        )

    conn = connect(DATABASE_URL, row_factory=dict_row)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    pc.id, pc.effective_date, pc.machine_name, pc.shift,
                    pc.operator_name, pc.pic_operator, pc.created_at,
                    pci.item_no, pci.item_check, pci.condition,
                    pci.machine_condition, pci.actual_inspec, pci.status, pci.remarks
                FROM production_checksheets pc
                LEFT JOIN production_check_items pci
                    ON pci.checksheet_id = pc.id
                ORDER BY pc.effective_date DESC, pc.created_at DESC, pc.id DESC, pci.item_no ASC
            """)
            rows = cur.fetchall()
    finally:
        conn.close()

    machine_order = [
        "Soldering",
        "Cutting Pipe Condenser",
        "Cutting Pipe Hotline",
        "Cutting Copper Tube",
        "Cutting & Notching",
        "Bending Auto Condensor Pipe",
    ]
    grouped = {}
    for row in rows:
        checksheet_id = row["id"]
        if checksheet_id not in grouped:
            grouped[checksheet_id] = {
                "effective_date": row["effective_date"],
                "machine_name": row.get("machine_name") or "Legacy / Tidak diketahui",
                "shift": row["shift"],
                "operator_name": row["operator_name"],
                "pic_operator": row.get("pic_operator") or "",
                "created_at": row["created_at"],
                "items": []
            }
        if row["item_no"] is not None:
            grouped[checksheet_id]["items"].append({
                "item_no": row["item_no"],
                "item_check": row["item_check"],
                "condition": row["condition"],
                "machine_condition": row["machine_condition"],
                "actual_inspec": row.get("actual_inspec") or "",
                "status": row.get("status") or ("OK" if row.get("machine_condition") == "RUN" else "NG"),
                "remarks": row.get("remarks") or ""
            })

    by_machine = {name: [] for name in machine_order}
    legacy = []

    def infer_legacy_machine(checksheet):
        item_names = {
            str(item.get("item_check") or "").strip().casefold()
            for item in checksheet.get("items", [])
        }
        # Strong signature from the original Soldering checksheet.
        soldering_signature = {
            "bearing roller",
            "pressure air compressor",
            "pressure lpg",
        }
        if soldering_signature.issubset(item_names):
            return "Soldering"
        # Use distinctive item labels only when they identify one machine.
        if "knife nocthing" in item_names or "mould cutting" in item_names:
            return "Cutting & Notching"
        if "control process cutting" in item_names and "pneumatic cylinder" in item_names:
            # Condenser and Hotline share the same checks; do not guess between them.
            return None
        if "control process cutting" in item_names and "v belt motor" in item_names:
            return "Cutting Copper Tube"
        return None

    for checksheet in grouped.values():
        name = checksheet["machine_name"]
        if name not in by_machine:
            name = infer_legacy_machine(checksheet)
        if name in by_machine:
            by_machine[name].append(checksheet)
        else:
            legacy.append(checksheet)

    # Keep ambiguous legacy rows out of the six fixed machine columns;
    # they are exported in a separate sheet rather than assigned to a guessed machine.

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "CYCLE"
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A2"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.15
    sheet.page_margins.right = 0.15
    sheet.page_margins.top = 0.3
    sheet.page_margins.bottom = 0.3

    # CYCLE: satu baris untuk setiap item pemeriksaan,
    # mengikuti format rekap METAL.
    headers = [
        "Tanggal", "JAM", "Nama Mesin", "Operator",
        "No", "Item Check", "Standard", "Actual Inspec", "Remarks"
    ]
    column_widths = {
        "A": 14, "B": 14, "C": 30, "D": 20, "E": 8,
        "F": 38, "G": 30, "H": 20, "I": 35
    }

    for column, width in column_widths.items():
        sheet.column_dimensions[column].width = width
    bold_font = Font(bold=True)
    normal_font = Font(size=10)
    thin_side = Side(style="thin", color="B7C9D6")
    thin_border = Border(
        left=thin_side, right=thin_side,
        top=thin_side, bottom=thin_side
    )
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    header_fill = PatternFill(fill_type="solid", fgColor="1F4E78")
    ng_fill = PatternFill(fill_type="solid", fgColor="FFC7CE")
    ok_fill = PatternFill(fill_type="solid", fgColor="C6EFCE")
    status_font = Font(bold=True, color="9C0006")

    for col_idx, value in enumerate(headers, start=1):
        cell = sheet.cell(1, col_idx, value)
        cell.fill = header_fill
        cell.font = bold_font
        cell.alignment = center
        cell.border = thin_border

    cycle_records = []
    for machine_name in machine_order:
        cycle_records.extend(by_machine.get(machine_name, []))

    cycle_records.sort(
        key=lambda record: str(record.get("created_at") or ""),
        reverse=True
    )

    row_num = 2
    for checksheet in cycle_records:
        created_at = checksheet.get("created_at")
        if created_at:
            if created_at.tzinfo is None:
                created_at = created_at.replace(
                    tzinfo=timezone(timedelta(hours=7))
                )
            time_text = created_at.astimezone(
                timezone(timedelta(hours=7))
            ).strftime("%H:%M WIB")
        else:
            time_text = ""

        for item_index, item in enumerate(
            checksheet.get("items", []), start=1
        ):
            item_no = item.get("item_no")
            if item_no is None:
                item_no = item_index

            status = str(
                item.get("status") or
                ("OK" if item.get("machine_condition") == "RUN" else "NG")
            ).strip().upper()

            values = [
                checksheet.get("effective_date"),
                time_text,
                checksheet.get("machine_name") or "",
                checksheet.get("operator_name") or "",
                item_no,
                item.get("item_check") or "",
                item.get("condition") or "",
                item.get("actual_inspec") or item.get("machine_condition") or "",
                item.get("remarks") or ""
            ]

            for col_idx, value in enumerate(values, start=1):
                cell = sheet.cell(row_num, col_idx, value)
                cell.font = normal_font
                cell.alignment = (
                    center if col_idx in (1, 2, 5, 8) else left
                )
                cell.border = thin_border

            sheet.cell(row_num, 1).number_format = "yyyy-mm-dd"

            actual_cell = sheet.cell(row_num, 8)
            if status in ("NG", "LAIN"):
                actual_cell.fill = ng_fill
                actual_cell.font = status_font
            elif status == "OK":
                actual_cell.fill = ok_fill
                actual_cell.font = status_font

            sheet.row_dimensions[row_num].height = 18
            row_num += 1

    sheet.auto_filter.ref = f"A1:I{max(1, row_num - 1)}"
    sheet.print_area = f"A1:I{max(1, row_num - 1)}"
    # Sheet METAL: layout checksheet per mesin, mengikuti format CYCLE.
    metal_names = [
        "300T-01", "300T-02",
        "400T-01", "400T-02", "400T-03", "400T-04",
        "250T-A01", "250T-A02", "250T-A03", "250T-A04", "250T-A05", "250T-A06",
        "250T-B01", "250T-B02", "250T-B03", "250T-B04",
        "250T-C01", "80T-01",
        "Spot Welding Siku Reinforce", "Spot Welding Hinge Part",
        "Spot Welding Nut Reinforce", "Spot Welding Reinforce R",
        "Spot Welding Reinforce L", "Spot Nut Hinge Upper",
        "Spot Nut Hinge Center", "45T-01", "40T-01", "45T-02", "Spot Welding Base Compresor"
    ]

    metal_sheet = workbook.create_sheet("METAL")
    metal_sheet.sheet_view.showGridLines = False
    metal_sheet.page_setup.orientation = "landscape"
    metal_sheet.page_setup.paperSize = metal_sheet.PAPERSIZE_A3
    metal_sheet.page_setup.fitToWidth = 1
    metal_sheet.page_setup.fitToHeight = 0
    metal_sheet.sheet_properties.pageSetUpPr.fitToPage = True
    metal_sheet.page_margins.left = 0.15
    metal_sheet.page_margins.right = 0.15
    metal_sheet.page_margins.top = 0.3
    metal_sheet.page_margins.bottom = 0.3

    # Rekap METAL: satu baris untuk setiap item pemeriksaan.
    headers = [
        "Tanggal", "JAM", "Nama Mesin", "Operator",
        "No", "Item Check", "Standard", "Actual Inspec", "Remarks"
    ]

    column_widths = {
        "A": 14, "B": 14, "C": 30, "D": 20, "E": 8,
        "F": 38, "G": 30, "H": 20, "I": 35
    }
    for column, width in column_widths.items():
        metal_sheet.column_dimensions[column].width = width

    metal_sheet.append(headers)
    header_fill = PatternFill(fill_type="solid", fgColor="1F4E78")
    ng_fill = PatternFill(fill_type="solid", fgColor="FFC7CE")
    ok_fill = PatternFill(fill_type="solid", fgColor="C6EFCE")
    status_font = Font(bold=True, color="9C0006")

    for col_idx, value in enumerate(headers, start=1):
        cell = metal_sheet.cell(1, col_idx)
        cell.value = value
        cell.fill = header_fill
        cell.font = bold_font
        cell.alignment = center
        cell.border = thin_border

    # Urutkan checksheet terbaru terlebih dahulu.
    metal_machine_names = set(metal_names)
    metal_checksheet_records = [
        record for record in grouped.values()
        if (record.get("machine_name") or "") in metal_machine_names
    ]
    metal_checksheet_records.sort(
        key=lambda record: str(record.get("created_at") or ""),
        reverse=True
    )

    row_num = 2
    for checksheet in metal_checksheet_records:
        machine_name = checksheet.get("machine_name") or ""
        effective_date = checksheet.get("effective_date")
        operator_name = checksheet.get("operator_name") or ""

        created_at = checksheet.get("created_at")
        if created_at:
            if created_at.tzinfo is None:
                created_at = created_at.replace(
                    tzinfo=timezone(timedelta(hours=7))
                )
            time_text = created_at.astimezone(
                timezone(timedelta(hours=7))
            ).strftime("%H:%M WIB")
        else:
            time_text = ""

        items = checksheet.get("items", [])
        for item_index, item in enumerate(items, start=1):
            item_no = item.get("item_no")
            if item_no is None:
                item_no = item_index

            values = [
                effective_date,
                time_text,
                machine_name,
                operator_name,
                item_no,
                item.get("item_check") or "",
                item.get("condition") or "",
                item.get("actual_inspec") or "",
                item.get("remarks") or ""
            ]

            for col_idx, value in enumerate(values, start=1):
                cell = metal_sheet.cell(row_num, col_idx, value)
                cell.font = normal_font
                cell.alignment = (
                    center if col_idx in (1, 2, 5, 8) else left
                )
                cell.border = thin_border

            metal_sheet.cell(row_num, 1).number_format = "yyyy-mm-dd"

            status = str(item.get("status") or "").strip().upper()
            actual_cell = metal_sheet.cell(row_num, 8)
            if status in ("NG", "LAIN"):
                actual_cell.fill = ng_fill
                actual_cell.font = status_font
            elif status == "OK":
                actual_cell.fill = ok_fill
                actual_cell.font = status_font

            metal_sheet.row_dimensions[row_num].height = 18
            row_num += 1

    metal_sheet.freeze_panes = "A2"
    metal_sheet.auto_filter.ref = f"A1:I{max(1, row_num - 1)}"
    metal_sheet.print_area = f"A1:I{max(1, row_num - 1)}"
    metal_sheet.page_setup.orientation = "landscape"
    metal_sheet.page_setup.fitToWidth = 1
    metal_sheet.page_setup.fitToHeight = 0
    metal_sheet.sheet_properties.pageSetUpPr.fitToPage = True

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    jakarta_now = datetime.now(timezone(timedelta(hours=7)))
    filename = "Production_Checksheet_Rekap_" + jakarta_now.strftime("%Y-%m-%d") + ".xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/api/production/checksheet")
def save_production_checksheet(
    data: ProductionChecksheetRequest,
    user=Depends(get_current_user)
):
    allowed_roles = [
        "SUPER_ADMIN",
        "ADMIN",
        "MANAGER_PRODUCTION",
        "OPERATOR"
    ]

    if user["role"] not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail="Anda tidak memiliki akses untuk menyimpan Production Checksheet."
        )


    if not data.operator_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Operator Name wajib diisi."
        )

    if not data.machine_name.strip():
        raise HTTPException(status_code=400, detail="Nama mesin wajib diisi.")

    if not data.checks or len(data.checks) > 9:
        raise HTTPException(status_code=400, detail="Jumlah item checksheet tidak valid.")

    for item in data.checks:
        if item.status not in ["OK", "NG"]:
            raise HTTPException(status_code=400, detail="Status harus OK atau NG.")
        if not item.actual_inspec.strip():
            raise HTTPException(status_code=400, detail="Actual Inspec wajib dipilih.")

    with get_db() as conn:

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS production_checksheets (
                id BIGSERIAL PRIMARY KEY,
                effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
                machine_name VARCHAR(200) NOT NULL DEFAULT 'Legacy / Tidak diketahui',
                shift VARCHAR(30) NOT NULL,
                operator_name VARCHAR(200) NOT NULL,
                pic_operator VARCHAR(200) NOT NULL,
                created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        conn.execute(
            "ALTER TABLE production_checksheets ADD COLUMN IF NOT EXISTS machine_name VARCHAR(200) NOT NULL DEFAULT 'Legacy / Tidak diketahui'"
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS production_check_items (
                id BIGSERIAL PRIMARY KEY,
                checksheet_id BIGINT NOT NULL
                    REFERENCES production_checksheets(id)
                    ON DELETE CASCADE,
                item_no INTEGER NOT NULL,
                item_check VARCHAR(200) NOT NULL,
                condition VARCHAR(200) NOT NULL,
                machine_condition VARCHAR(10) NOT NULL
                    CHECK (machine_condition IN ('RUN', 'STOP')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.execute("ALTER TABLE production_check_items ADD COLUMN IF NOT EXISTS actual_inspec VARCHAR(200) NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE production_check_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'OK'")
        conn.execute("ALTER TABLE production_check_items ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE production_check_items ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT ''")

        header = conn.execute(
            """
            INSERT INTO production_checksheets
            (
                effective_date,
                machine_name,
                shift,
                operator_name,
                pic_operator,
                created_by
            )
            VALUES
            (
                CURRENT_DATE,
                %s,
                %s,
                %s,
                %s,
                %s
            )
            RETURNING id
            """,
            (
                data.machine_name.strip(),
                data.shift,
                data.operator_name.strip(),
                data.pic_operator.strip(),
                user["id"]
            )
        ).fetchone()

        checksheet_id = header["id"]

        for index, item in enumerate(data.checks, start=1):

            conn.execute(
                """
                INSERT INTO production_check_items
                (
                    checksheet_id,
                    item_no,
                    item_check,
                    condition,
                    machine_condition,
                    actual_inspec,
                    status,
                    remarks
                )
                VALUES
                (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                """,
                (
                    checksheet_id,
                    index,
                    item.item_check.strip(),
                    item.condition.strip(),
                    "RUN" if item.status == "OK" else "STOP",
                    item.actual_inspec.strip(),
                    "NG" if item.actual_inspec.strip().upper() == "NG" else "OK",
                    item.remarks.strip()
                )
            )

        conn.execute(
            """
            INSERT INTO audit_logs
            (
                user_id,
                username,
                action,
                description
            )
            VALUES
            (
                %s,
                %s,
                'SAVE_PRODUCTION_CHECKSHEET',
                %s
            )
            """,
            (
                user["id"],
                user["username"],
                "Production Checksheet ID " + str(checksheet_id) + " - " + data.machine_name.strip()
            )
        )

        return {
            "ok": True,
            "message": "Production Checksheet berhasil disimpan.",
            "checksheet_id": checksheet_id
        }



@app.post("/api/public/production/checksheet")
def save_public_production_checksheet(data: ProductionChecksheetRequest):
    allowed_machines = {
        "Soldering",
        "Cutting Pipe Condenser",
        "Cutting Pipe Hotline",
        "Cutting Copper Tube",
        "Cutting & Notching",
        "Bending Auto Condensor Pipe",
        "300T-01",
        "400T-01",
        "400T-02",
        "400T-03",
        "250T-A01",
        "300T-02",
        "400T-04",
        "250T-A02",
        "250T-A03",
        "250T-A04",
        "250T-A05",
        "250T-A06",
        "250T-B01",
        "250T-B02",
        "250T-B03",
        "250T-B04",
        "80T-01",
        "250T-C01",
        "Spot Welding Siku Reinforce",
        "Spot Welding Hinge Part",
        "45T-01",
        "40T-01",
        "45T-02", "Spot Welding Base Compresor",
        "Spot Welding Nut Reinforce",
        "Spot Welding Reinforce R",
        "Spot Welding Reinforce L",
        "Spot Nut Hinge Upper",
        "Spot Nut Hinge Center",
    }
    if data.machine_name.strip() not in allowed_machines:
        raise HTTPException(status_code=400, detail="Nama mesin tidak diizinkan.")

    # Gunakan validasi dan proses simpan checksheet yang sudah ada.
    public_user = {"id": None, "username": "PUBLIC_QR", "role": "OPERATOR"}
    return save_production_checksheet(data, user=public_user)


@app.get("/api/audit-logs")
def get_audit_logs(user=Depends(get_current_user)):

    if user["role"] != "SUPER_ADMIN":
        raise HTTPException(
            status_code=403,
            detail="Hanya SUPER_ADMIN yang dapat melihat Audit Log."
        )

    with get_db() as conn:

        rows = conn.execute(
            """
            SELECT
                id,
                user_id,
                username,
                action,
                description,
                ip_address,
                created_at
            FROM audit_logs
            ORDER BY created_at DESC, id DESC
            LIMIT 200
            """
        ).fetchall()

        return {
            "ok": True,
            "total": len(rows),
            "logs": rows
        }

EFFICIENCY_CYCLE_TIME_SECONDS = {
    "TPL 1": 7,
    "TPL 2": 6,
    "Plate Rear": 12,
    "Machine Bottom Plate": 5,
    "Assy Plate Rear R1": 14,
    "Assy Bottom Plate": 6,
}


class EfficiencyEntryRequest(BaseModel):
    inspection_date: str
    shift: str
    efficiency_type: str
    total_working_time: float
    good_quantity: float
    defect_quantity: float = 0
    stop_as_planned_value: float = 0
    stop_time_value: float = 0


@app.on_event("startup")
def init_efficiency_columns():
    with get_db() as conn:
        conn.execute("""
            ALTER TABLE excel_dashboard_operator_rows
            ADD COLUMN IF NOT EXISTS shift VARCHAR(30) NOT NULL DEFAULT 'Shift 1'
        """)
        conn.execute("""
            ALTER TABLE excel_dashboard_operator_rows
            ADD COLUMN IF NOT EXISTS defect_quantity DOUBLE PRECISION NOT NULL DEFAULT 0
        """)
        conn.execute("""
            ALTER TABLE excel_dashboard_operator_rows
            ADD COLUMN IF NOT EXISTS efficiency_type VARCHAR(100) NOT NULL DEFAULT 'Machine Bottom Plate'
        """)
        conn.commit()


@app.post("/api/efficiency/entries")
def create_efficiency_entry(data: EfficiencyEntryRequest, user=Depends(get_current_user)):
    allowed_roles = {"SUPER_ADMIN", "ADMIN", "MANAGER_PRODUCTION", "OPERATOR"}
    if user["role"] not in allowed_roles:
        raise HTTPException(status_code=403, detail="Role tidak diizinkan menginput Efficiency.")

    allowed_efficiency_types = {
        "TPL 1", "TPL 2", "Plate Rear",
        "Machine Bottom Plate", "Assy Plate Rear R1", "Assy Bottom Plate"
    }
    if data.efficiency_type not in allowed_efficiency_types:
        raise HTTPException(status_code=400, detail="Efficiency Type tidak valid.")

    if data.shift not in {"Shift 1", "Shift 2", "Shift 3"}:
        raise HTTPException(status_code=400, detail="Shift harus Shift 1, Shift 2, atau Shift 3.")
    try:
        datetime.strptime(data.inspection_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal harus YYYY-MM-DD.")

    if data.total_working_time <= 0:
        raise HTTPException(status_code=400, detail="Total Working Time harus lebih dari 0.")
    if data.good_quantity < 0 or data.defect_quantity < 0:
        raise HTTPException(status_code=400, detail="Quantity tidak boleh negatif.")

    cycle_time_seconds = EFFICIENCY_CYCLE_TIME_SECONDS[data.efficiency_type]
    loaded_time = data.total_working_time - data.stop_as_planned_value - data.stop_time_value
    if loaded_time <= 0:
        raise HTTPException(status_code=400, detail="Loaded Time harus lebih dari 0 setelah dikurangi stop.")
    total_output = data.good_quantity + data.defect_quantity
    actual_eff = (cycle_time_seconds * total_output) / (loaded_time * 60) * 100

    with get_db() as conn:
        conn.execute("""
            INSERT INTO excel_dashboard_operator_rows
                (area, inspection_date, target_eff, actual_eff, acc_eff,
                 loaded_time, good_quantity, created_by, shift, defect_quantity, efficiency_type)
            VALUES
                (%s, %s, 90, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            "Machine Bottom Plate",
            data.inspection_date,
            actual_eff,
            actual_eff,
            loaded_time,
            data.good_quantity,
            user["id"],
            data.shift,
            data.defect_quantity,
            data.efficiency_type
        ))
        conn.commit()

    return {"ok": True, "actual_eff": round(actual_eff, 2)}


@app.get("/api/efficiency/daily")
def get_efficiency_daily(
    efficiency_type: str = "Machine Bottom Plate",
    user=Depends(get_current_user)
):
    allowed_efficiency_types = {
        "TPL 1", "TPL 2", "Plate Rear",
        "Machine Bottom Plate", "Assy Plate Rear R1", "Assy Bottom Plate"
    }
    if efficiency_type not in allowed_efficiency_types:
        raise HTTPException(status_code=400, detail="Efficiency Type tidak valid.")

    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                inspection_date,
                COALESCE(SUM(loaded_time), 0) AS total_working_time,
                COALESCE(SUM(good_quantity), 0) AS good_quantity,
                COALESCE(SUM(defect_quantity), 0) AS defect_quantity,
                efficiency_type
            FROM excel_dashboard_operator_rows
            WHERE area = 'Machine Bottom Plate'
              AND efficiency_type = %s
            GROUP BY inspection_date, efficiency_type
            ORDER BY inspection_date
        """, (efficiency_type,)).fetchall()

    daily = []
    for row in rows:
        good = float(row["good_quantity"] or 0)
        defect = float(row["defect_quantity"] or 0)
        working_time = float(row["total_working_time"] or 0)
        output = good + defect
        daily.append({
            "date": row["inspection_date"].isoformat()
                if hasattr(row["inspection_date"], "isoformat")
                else str(row["inspection_date"]),
            "total_working_time": working_time,
            "good_quantity": good,
            "defect_quantity": defect,
            "total_output": output,
            "defect_rate": (defect / output * 100) if output else 0,
            "actual_eff": (EFFICIENCY_CYCLE_TIME_SECONDS[row["efficiency_type"]] * output / (working_time * 60) * 100)
                if working_time else 0,
            "target_eff": 90
        })

    return {"ok": True, "daily": daily}


# Serve Sangil Production frontend
if os.path.isdir("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")



















