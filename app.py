from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
from flask_cors import CORS



app = Flask(__name__)
CORS(app)

# Systems and rates data for pool and cold plunge
systems = {
    "cold_plunge": {
        "volume": 126,
        "targets": {
            "Total Hardness": 150,
            "Total Chlorine": 3,
            "Free Chlorine": 2,
            "Bromine": 4,
            "Total Alkalinity": 120,
            "Cyanuric Acid": 0,
            "pH": 7.4
        }
    },
    "pool": {
        "volume": 15000,
        "targets": {
            "Total Hardness": 300,
            "Total Chlorine": 3,
            "Free Chlorine": 3,
            "Total Alkalinity": 100,
            "Cyanuric Acid": 40,
            "pH": 7.4
        }
    }
}

rates = {
    "cold_plunge": {
        "Total Hardness": {"up": 15 / 100, "down": 0},
        "Total Chlorine": {"up": 2.5 / 100, "down": 0},
        "Free Chlorine": {"up": 2.5 / 100, "down": 0},
        "Bromine": {"up": 0, "down": 0},
        "Total Alkalinity": {"up": 15 / 100, "down": 0},
        "Cyanuric Acid": {"up": 0, "down": 0},
        "pH": {"up": 5 / 100 / 0.2, "down": 5 / 100 / 0.2}
    },
    "pool": {
        "Total Hardness": {"up": 0.0068, "down": 0},
        "Total Chlorine": {"up": 0.004, "down": 0},
        "Free Chlorine": {"up": 0.004, "down": 0},
        "Bromine": {"up": 0, "down": 0},
        "Total Alkalinity": {"up": 0.0068, "down": 0},
        "Cyanuric Acid": {"up": 0.0453, "down": 0},
        "pH": {"up": 0.425, "down": 0.0525}
    }
}

def init_db():
    conn = sqlite3.connect("pool_data.db")
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, system TEXT, volume REAL,
        total_hardness_current REAL, total_hardness_target REAL, total_hardness_adjust REAL,
        total_chlorine_current REAL, total_chlorine_target REAL, total_chlorine_adjust REAL,
        free_chlorine_current REAL, free_chlorine_target REAL, free_chlorine_adjust REAL,
        bromine_current REAL, bromine_target REAL, bromine_adjust REAL,
        total_alkalinity_current REAL, total_alkalinity_target REAL, total_alkalinity_adjust REAL,
        cyanuric_acid_current REAL, cyanuric_acid_target REAL, cyanuric_acid_adjust REAL,
        ph_current REAL, ph_target REAL, ph_adjust REAL
    )''')
    conn.commit()
    conn.close()

def calculate_adjustment(current, target, volume, rate_up, rate_down, field):
    difference = target - current
    if difference > 0:
        adjustment = difference * volume * rate_up
        direction = "up"
        chemical = f"{field} Increaser" if "pH" not in field else "pH Increaser"
        if "Chlorine" in field:
            chemical = "Chlorinating Concentrate"
    elif difference < 0:
        adjustment = -difference * volume * rate_down
        direction = "down"
        chemical = f"{field} Reducer" if "pH" not in field else "pH Decreaser"
    else:
        return 0, None, None
    return adjustment, direction, chemical

@app.route('/systems', methods=['GET'])
def get_systems():
    return jsonify(systems)

@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.json
    system = data['system']
    current = data['current']
    volume = systems[system]['volume']
    targets = systems[system]['targets']
    system_rates = rates[system]

    adjustments = {}
    needs_shock = False
    shock_amount = 0
    for field in targets:
        adj = calculate_adjustment(current[field], targets[field], volume,
                                  system_rates[field]['up'], system_rates[field]['down'], field)
        if adj and "Chlorine" in field and adj[1] == "down":
            needs_shock = True
            shock_amount = max(shock_amount, (28 / 500) * volume)
            adjustments[field] = (0, None, None)  # Ensure an entry exists
        else:
            adjustments[field] = adj if adj[0] != 0 else (0, None, None)

    # Save to SQLite
    conn = sqlite3.connect("pool_data.db")
    c = conn.cursor()
    c.execute('''INSERT INTO readings (
        date, system, volume,
        total_hardness_current, total_hardness_target, total_hardness_adjust,
        total_chlorine_current, total_chlorine_target, total_chlorine_adjust,
        free_chlorine_current, free_chlorine_target, free_chlorine_adjust,
        bromine_current, bromine_target, bromine_adjust,
        total_alkalinity_current, total_alkalinity_target, total_alkalinity_adjust,
        cyanuric_acid_current, cyanuric_acid_target, cyanuric_acid_adjust,
        ph_current, ph_target, ph_adjust
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
    (
        datetime.today().strftime("%Y-%m-%d"), system, volume,
        current['Total Hardness'], targets['Total Hardness'], adjustments['Total Hardness'][0],
        current['Total Chlorine'], targets['Total Chlorine'], adjustments['Total Chlorine'][0],
        current['Free Chlorine'], targets['Free Chlorine'], adjustments['Free Chlorine'][0],
        current['Bromine'], targets['Bromine'], adjustments['Bromine'][0],
        current['Total Alkalinity'], targets['Total Alkalinity'], adjustments['Total Alkalinity'][0],
        current['Cyanuric Acid'], targets['Cyanuric Acid'], adjustments['Cyanuric Acid'][0],
        current['pH'], targets['pH'], adjustments['pH'][0]
    ))
    conn.commit()
    conn.close()

    response = {"adjustments": adjustments}
    if needs_shock:
        response["shock"] = {"amount": shock_amount, "chemical": "Enhanced Shock"}
    return jsonify(response)

    @app.route('/', methods=['GET'])
    def home():
        return jsonify({"message": "Welcome to the Pool & Cold Plunge Chemistry Assistant!"})

if __name__ == '__main__':
    init_db()
    app.run(debug=True)