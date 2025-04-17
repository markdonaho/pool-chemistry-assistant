# Python Cloud Functions
import functions_framework
import firebase_admin
from firebase_admin import initialize_app, credentials
import numpy as np
import cv2
import os
import math # Needed for Euclidean distance

# Initialize Firebase Admin SDK (if not already initialized)
# Use application default credentials locally or on GCP/Cloud Functions
try:
    if not firebase_admin._apps:
        initialize_app()
except ValueError as e:
    print(f"Firebase Admin SDK already initialized? {e}")


# --- Helper Function to Convert RGB to LAB ---
# Note: OpenCV expects BGR format for its built-in conversion.
# If providing RGB values directly, we'll convert BGR -> LAB.
def rgb_to_lab(rgb):
    # Convert single RGB pixel to a 1x1 BGR image
    bgr_pixel = np.uint8([[rgb[::-1]]]) # Reverse RGB to BGR
    lab_pixel = cv2.cvtColor(bgr_pixel, cv2.COLOR_BGR2LAB)
    return lab_pixel[0][0].tolist() # Return as a list [L, A, B]

# --- Define Color Key (Using estimated RGB converted to LAB) ---
# Values sampled visually from the provided image, accuracy may vary.
# Structure: { parameter: [ { lab: [L, a, b], value: ppm/pH }, ... ] }
COLOR_KEY = {
    "Total Hardness": [
        {"lab": rgb_to_lab([94, 114, 97]), "value": 0},    # Olive green
        {"lab": rgb_to_lab([133, 103, 105]), "value": 25},   # Mauve brown
        {"lab": rgb_to_lab([148, 101, 100]), "value": 50},   # Brown
        {"lab": rgb_to_lab([156, 107, 107]), "value": 120},  # Reddish brown
        {"lab": rgb_to_lab([173, 111, 111]), "value": 250},  # Lighter red-brown
        {"lab": rgb_to_lab([188, 111, 111]), "value": 425}   # Pinkish brown (est)
    ],
    "Total Chlorine": [
        {"lab": rgb_to_lab([253, 252, 217]), "value": 0},    # Pale yellow
        {"lab": rgb_to_lab([245, 246, 195]), "value": 0.5},  # Light yellow-green
        {"lab": rgb_to_lab([228, 235, 182]), "value": 1},    # Yellow-green
        {"lab": rgb_to_lab([206, 224, 159]), "value": 3},    # Light green
        {"lab": rgb_to_lab([183, 211, 158]), "value": 5},    # Mint green
        {"lab": rgb_to_lab([106, 195, 166]), "value": 10},   # Turquoise
        {"lab": rgb_to_lab([78, 185, 168]), "value": 20}    # Dark turquoise
    ],
    "Free Chlorine": [
        {"lab": rgb_to_lab([255, 255, 255]), "value": 0},    # White
        {"lab": rgb_to_lab([255, 238, 240]), "value": 0.5},  # Very light pink
        {"lab": rgb_to_lab([255, 218, 223]), "value": 1},    # Light pink
        {"lab": rgb_to_lab([235, 155, 195]), "value": 3},    # Medium pink/magenta
        {"lab": rgb_to_lab([208, 117, 167]), "value": 5},    # Dark pink/magenta
        {"lab": rgb_to_lab([178, 100, 140]), "value": 10},   # Purple pink
        {"lab": rgb_to_lab([150, 85, 119]), "value": 20}    # Dark purple pink
    ],
    "Bromine": [
        {"lab": rgb_to_lab([255, 255, 255]), "value": 0},    # White
        {"lab": rgb_to_lab([255, 238, 240]), "value": 1},    # Very light pink (Same as FC 0.5)
        {"lab": rgb_to_lab([255, 218, 223]), "value": 2},    # Light pink (Same as FC 1)
        {"lab": rgb_to_lab([235, 155, 195]), "value": 6},    # Medium pink/magenta (Same as FC 3)
        {"lab": rgb_to_lab([208, 117, 167]), "value": 10},   # Dark pink/magenta (Same as FC 5)
        {"lab": rgb_to_lab([178, 100, 140]), "value": 20},   # Purple pink (Same as FC 10)
        {"lab": rgb_to_lab([150, 85, 119]), "value": 40}    # Dark purple pink (Same as FC 20)
    ],
    "Total Alkalinity": [
        {"lab": rgb_to_lab([255, 242, 180]), "value": 0},    # Light yellow
        {"lab": rgb_to_lab([205, 238, 183]), "value": 40},   # Yellow-green
        {"lab": rgb_to_lab([149, 203, 158]), "value": 80},   # Medium green
        {"lab": rgb_to_lab([99, 167, 127]), "value": 120},  # Forest green
        {"lab": rgb_to_lab([67, 137, 117]), "value": 180},  # Dark green/teal
        {"lab": rgb_to_lab([50, 109, 103]), "value": 240},  # Dark teal
        {"lab": rgb_to_lab([43, 92, 90]), "value": 360}     # Darkest teal/green
    ],
    "Cyanuric Acid": [
        {"lab": rgb_to_lab([255, 205, 183]), "value": 0},    # Light peach
        # Represents the 30-50 block. We'll use interpolation logic later.
        {"lab": rgb_to_lab([255, 195, 177]), "value": 30},   # Peach
        {"lab": rgb_to_lab([255, 195, 177]), "value": 50},   # Using same color for 50
        {"lab": rgb_to_lab([255, 184, 172]), "value": 100},  # Darker peach/pink
        {"lab": rgb_to_lab([255, 174, 167]), "value": 150},  # Pink peach
        {"lab": rgb_to_lab([255, 164, 162]), "value": 240}   # Pink
    ],
    "pH": [
        {"lab": rgb_to_lab([255, 188, 162]), "value": 6.2},  # Light orange
        {"lab": rgb_to_lab([255, 174, 150]), "value": 6.8},  # Orange
        {"lab": rgb_to_lab([255, 159, 138]), "value": 7.2},  # Darker orange
        {"lab": rgb_to_lab([255, 143, 126]), "value": 7.8},  # Red orange
        {"lab": rgb_to_lab([255, 128, 116]), "value": 8.4},  # Red
        {"lab": rgb_to_lab([255, 113, 108]), "value": 9.0}   # Dark red
    ]
}

# --- Define Normal Ranges (Based on Green Bars) ---
# Structure: { parameter: { min: value, max: value } }
NORMAL_RANGES = {
    "Total Hardness": {"min": 120, "max": 250},
    "Total Chlorine": {"min": 1, "max": 5}, # Approximate range covering 1, 3, 5
    "Free Chlorine": {"min": 1, "max": 5},  # Approximate range covering 1, 3, 5
    "Bromine": {"min": 2, "max": 10},        # Approximate range covering 2, 6, 10
    "Total Alkalinity": {"min": 80, "max": 120},
    "Cyanuric Acid": {"min": 30, "max": 100}, # Covers 30-50 and 100 block
    "pH": {"min": 7.2, "max": 7.8}
    # Special pH note: Label says "For best results, pH must be between 7.0-8.4"
    # The green bars are 7.2-7.8. Let's stick to the green bars for visual consistency.
}


# --- Placeholder Functions for CV Steps (To be implemented) ---

def detect_strip(img):
    # TODO: Implement logic to find the main bounding box of the test strip
    print("TODO: Detect Strip")
    # Return dummy coordinates covering most of a typical strip for now
    # Format: (x, y, width, height) or None if not found
    h, w = img.shape[:2]
    return (int(w*0.1), int(h*0.05), int(w*0.8), int(h*0.9)) 

def align_strip(img, strip_bbox):
    # TODO: Implement perspective correction if needed, based on detected corners
    print("TODO: Align Strip (Perspective Correction)")
    # For now, just crop to the bounding box
    x, y, w, h = strip_bbox
    aligned_img = img[y:y+h, x:x+w]
    # Return the aligned/cropped image and any transformation matrix if calculated
    return aligned_img, None 

def locate_pads(aligned_img, num_pads=7):
    # TODO: Implement logic to find the centers/bboxes of the 7 pads
    # within the aligned_img, likely based on expected vertical spacing.
    print("TODO: Locate Pads")
    pad_height_approx = aligned_img.shape[0] / num_pads
    pad_centers = []
    for i in range(num_pads):
        center_y = int(pad_height_approx * (i + 0.5))
        center_x = int(aligned_img.shape[1] * 0.5) # Assume centered horizontally
        pad_centers.append((center_x, center_y))
    
    # Return list of (x, y) coordinates relative to aligned_img
    # These need to be mapped back to original image coords later for feedback
    return pad_centers 

def sample_pad_color(img, center, sample_size=10):
    # TODO: Improve sampling (e.g., median of a square area)
    print(f"TODO: Sample Pad Color at {center}")
    x, y = center
    # Ensure sample area is within bounds
    h, w = img.shape[:2]
    half_size = sample_size // 2
    x1 = max(0, x - half_size)
    y1 = max(0, y - half_size)
    x2 = min(w, x + half_size)
    y2 = min(h, y + half_size)
    
    if y2 <= y1 or x2 <= x1:
         print(f"Warning: Sample area for {center} is invalid or zero size.")
         return None # Cannot sample

    sample_area = img[y1:y2, x1:x2]
    
    # Calculate median color in LAB space
    if sample_area.size == 0:
        print(f"Warning: Sample area empty for {center}.")
        return None

    # Convert sample area BGR to LAB
    lab_sample_area = cv2.cvtColor(sample_area, cv2.COLOR_BGR2LAB)
    
    # Reshape to list of pixels and find median
    pixels = lab_sample_area.reshape(-1, 3)
    median_lab = np.median(pixels, axis=0)
    
    return median_lab.tolist() # Return [L, a, b]

def match_color(sampled_lab, parameter_key):
    # TODO: Implement LAB distance + interpolation
    print(f"TODO: Match Color for {parameter_key}")
    
    if sampled_lab is None:
        return None, [] # No color sampled

    min_dist = float('inf')
    best_match_value = None
    
    # Simple closest match for now (Euclidean distance in LAB)
    distances = []
    for entry in COLOR_KEY[parameter_key]:
        key_lab = entry["lab"]
        dist = math.sqrt(sum([(a - b) ** 2 for a, b in zip(sampled_lab, key_lab)]))
        distances.append({'dist': dist, 'value': entry['value']})
        
        # Basic closest match (replace with interpolation later)
        if dist < min_dist:
            min_dist = dist
            best_match_value = entry["value"]

    # Sort distances for potential interpolation
    distances.sort(key=lambda x: x['dist'])

    # --- Basic Interpolation (Example - Needs Refinement) ---
    if len(distances) >= 2:
        d1 = distances[0]['dist']
        d2 = distances[1]['dist']
        v1 = distances[0]['value']
        v2 = distances[1]['value']
        
        total_dist = d1 + d2
        if total_dist > 1e-6: # Avoid division by zero if colors are identical
             # Weighted average based on inverse distance
             interpolated_value = (v1 * d2 + v2 * d1) / total_dist
             # Round based on parameter type (e.g., pH needs decimals)
             if parameter_key == 'pH':
                 best_match_value = round(interpolated_value, 1)
             else:
                 # Round ppm values sensibly (e.g., nearest whole number or 0.5)
                 best_match_value = round(interpolated_value * 2) / 2 
        else:
             best_match_value = v1 # Exactly matched the first color


    # Return interpolated value and sorted list of distances/values
    return best_match_value, distances


@functions_framework.http
def process_test_strip(request):
    """
    HTTP Cloud Function to process a test strip image.
    Expects a POST request with multipart/form-data containing an 'image' file.
    """
    if request.method != 'POST':
        return 'Method Not Allowed', 405

    # TODO: Add Authentication check (e.g., using request.headers.get('Authorization'))

    image_file = request.files.get('image')
    if not image_file:
        return 'Missing image file in request', 400

    try:
        # Read image file into memory
        image_bytes = image_file.read()
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img_original = cv2.imdecode(np_arr, cv2.IMREAD_COLOR) # Keep original

        if img_original is None:
            return 'Could not decode image', 400
            
        print(f"Image received, shape: {img_original.shape}")

        # --- CV Processing Steps ---
        
        # 1. Detect Strip (using placeholder)
        strip_bbox = detect_strip(img_original)
        if not strip_bbox:
            return "Could not detect test strip in image.", 400
            
        # 2. Align/Correct Perspective (using placeholder)
        # Pass the original image here
        aligned_strip_img, M = align_strip(img_original, strip_bbox) 
        if aligned_strip_img is None or aligned_strip_img.size == 0:
             return "Failed to align/crop strip.", 500
        print(f"Aligned strip shape: {aligned_strip_img.shape}")

        # 3. Locate Pads (using placeholder)
        # Use the aligned/cropped image
        pad_centers_relative = locate_pads(aligned_strip_img) 
        if not pad_centers_relative or len(pad_centers_relative) != 7:
            return f"Could not locate all 7 pads (found {len(pad_centers_relative)}).", 400

        # Define order of pads matching the COLOR_KEY/NORMAL_RANGES structure
        # IMPORTANT: This order MUST match the physical order on the strip top-to-bottom
        parameter_order = [
            "Total Hardness", "Total Chlorine", "Free Chlorine", 
            "Bromine", "Total Alkalinity", "Cyanuric Acid", "pH"
        ]

        calculated_readings = {}
        pad_coordinates_feedback = [] # For frontend overlay

        # 4. Sample Pad Colors & 5. Match Colors
        for i, parameter in enumerate(parameter_order):
            center_relative = pad_centers_relative[i]
            
            # Sample color from the aligned image
            sampled_lab = sample_pad_color(aligned_strip_img, center_relative) 
            
            # Match color using the defined key
            matched_value, _ = match_color(sampled_lab, parameter) # Ignore distances for now
            
            calculated_readings[parameter] = matched_value if matched_value is not None else "N/A"

            # 6. Get Coordinates for Feedback (map back to original image)
            # Placeholder: Use relative centers for now, needs proper inverse transform if alignment changes coords
            # We need the *original* image coordinates of the center of the pad
            strip_x, strip_y, _, _ = strip_bbox
            original_x = strip_x + center_relative[0]
            original_y = strip_y + center_relative[1]
            
            # TODO: If perspective transform 'M' was calculated, apply inverse transform here
            # Example: original_coords = cv2.perspectiveTransform(np.array([[center_relative]], dtype=np.float32), np.linalg.inv(M))
            # original_x = int(original_coords[0][0][0])
            # original_y = int(original_coords[0][0][1])
            
            pad_coordinates_feedback.append({
                'parameter': parameter,
                'x': original_x,
                'y': original_y,
                'radius': 5 # Placeholder radius
            })

        # --- Prepare Response ---
        response_data = {
            'readings': calculated_readings,
            'padCoordinates': pad_coordinates_feedback, # Coordinates for frontend overlay
            'normalRanges': NORMAL_RANGES # Use the actual ranges
        }
        
        print("Processing Complete. Response:", response_data)

        return response_data, 200

    except Exception as e:
        print(f"Error processing image: {e}")
        import traceback
        traceback.print_exc() # Print full traceback for debugging
        return 'Internal Server Error processing image', 500 