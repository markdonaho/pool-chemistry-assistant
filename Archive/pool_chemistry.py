from datetime import datetime
import csv
import curses

# System data with default volumes and targets
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

# Chemical rates (grams per gallon to change by 1 unit) - unchanged from your original
rates = {
    "cold_plunge": {
        "Total Hardness": {"up": 15 / 100, "down": 0},  # 0.15 g/gal per 1 ppm
        "Total Chlorine": {"up": 2.5 / 100, "down": 0},  # 0.025 g/gal per 1 ppm
        "Free Chlorine": {"up": 2.5 / 100, "down": 0},   # 0.025 g/gal per 1 ppm
        "Bromine": {"up": 0, "down": 0},
        "Total Alkalinity": {"up": 15 / 100, "down": 0},  # 0.15 g/gal per 1 ppm
        "Cyanuric Acid": {"up": 0, "down": 0},
        "pH": {"up": 5 / 100 / 0.2, "down": 5 / 100 / 0.2}  # 0.25 g/gal per 0.2 pH units
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

def calculate_adjustment(current, target, volume, rate_up, rate_down, field):
    difference = target - current
    if difference > 0:  # Increase
        adjustment = difference * volume * rate_up
        direction = "up"
        chemical = f"{field} Increaser" if "pH" not in field else "pH Increaser"
        if "Chlorine" in field:
            chemical = "Chlorinating Concentrate"
    elif difference < 0:  # Decrease
        adjustment = -difference * volume * rate_down
        direction = "down"
        chemical = f"{field} Reducer" if "pH" not in field else "pH Decreaser"
    else:
        return 0, None, None
    return adjustment, direction, chemical

def save_to_file(system, data, targets, current, adjustments):
    filename = f"{system}_data.csv"
    fields = list(targets.keys())
    headers = ["Date", "Volume"] + [f"Target {f}" for f in fields] + \
              [f"Current {f}" for f in fields] + [f"Adjust {f}" for f in fields]
    row = [data["Date"], data["Volume"]]
    row.extend(targets[f] for f in fields)
    row.extend(current[f] for f in fields)
    row.extend(adjustments.get(f, (0, None, None))[0] for f in fields)
    
    with open(filename, "a", newline="") as f:
        writer = csv.writer(f)
        if f.tell() == 0:  # Write headers if file is empty
            writer.writerow(headers)
        writer.writerow(row)

def menu(stdscr):
    options = ["cold_plunge", "pool"]
    current_row = 0
    curses.curs_set(0)
    stdscr.clear()
    
    while True:
        stdscr.clear()
        stdscr.addstr(0, 0, "Select system (use arrow keys, press Enter):")
        for idx, option in enumerate(options):
            if idx == current_row:
                stdscr.addstr(idx + 2, 0, f"> {option}", curses.A_REVERSE)
            else:
                stdscr.addstr(idx + 2, 0, f"  {option}")
        stdscr.refresh()
        
        key = stdscr.getch()
        if key == curses.KEY_UP and current_row > 0:
            current_row -= 1
        elif key == curses.KEY_DOWN and current_row < len(options) - 1:
            current_row += 1
        elif key == curses.KEY_ENTER or key in [10, 13]:
            return options[current_row]

# Main program
system = curses.wrapper(menu)
volume = systems[system]["volume"]
targets = systems[system]["targets"]
fields = list(targets.keys())
system_rates = rates[system]

# Collect data
print(f"\nEntering data for {system} (default volume: {volume} gallons)")
data = {"Date": datetime.today().strftime("%Y-%m-%d"), "Volume": volume}
print(f"Date set to {data['Date']} (default)")
print("Target values:")
for field, target in targets.items():
    print(f"{field}: {target}")

# Get current readings
current = {}
print("\nEnter current readings:")
for field in fields:
    while True:
        try:
            current[field] = float(input(f"Current {field} (target: {targets[field]}): "))
            break
        except ValueError:
            print("Please enter a valid number.")

# Calculate adjustments
adjustments = {}
needs_shock = False
shock_amount = 0
for field in fields:
    adjustment = calculate_adjustment(current[field], targets[field], volume, 
                                     system_rates[field]["up"], system_rates[field]["down"], field)
    if adjustment and "Chlorine" in field and adjustment[1] == "down":
        needs_shock = True
        shock_amount = max(shock_amount, (28 / 500) * volume)  # 28g/500gal base dose
        adjustments[field] = (0, None, None)  # No adjustment, just shock
    else:
        adjustments[field] = adjustment if adjustment != (0, None, None) else (0, None, None)

# Display adjustments
print("\nAdjustments:")
for field in fields:
    amount, direction, chemical = adjustments[field]
    if amount != 0:
        print(f"Add {amount:.2f}g of {chemical}")
    elif direction is None:
        print(f"{field} is on target")
if needs_shock:
    print(f"Add {shock_amount:.2f}g of Enhanced Shock (midweek treatment)")

# Save to file
save_to_file(system, data, targets, current, adjustments)
print(f"Data saved to {system}_data.csv")