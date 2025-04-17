# Python Cloud Functions
import functions_framework
import firebase_admin
from firebase_admin import initialize_app, credentials, auth # Import auth
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

def order_points(pts):
    # Initialzie a list of coordinates that will be ordered
    # such that the first entry in the list is the top-left,
    # the second entry is the top-right, the third is the
    # bottom-right, and the fourth is the bottom-left
    rect = np.zeros((4, 2), dtype="float32")

    # The top-left point will have the smallest sum, whereas
    # the bottom-right point will have the largest sum
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]

    # Now, compute the difference between the points, the
    # top-right point will have the smallest difference,
    # whereas the bottom-left will have the largest difference
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]

    # return the ordered coordinates
    return rect

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
        # Simplified 30-50 range to a single 40 point
        {"lab": rgb_to_lab([255, 195, 177]), "value": 40},   # Peach (representing old 30-50 block)
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
    print("Detecting strip...")
    img_height, img_width = img.shape[:2]
    min_strip_area = img_height * img_width * 0.01 # Strip should be at least 1% of image area
    max_strip_area = img_height * img_width * 0.80 # Strip shouldn't be the whole image

    # 1. Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 2. Blur
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # 3. Edge Detection (adjust thresholds as needed)
    # Lower thresholds detect weaker edges, higher thresholds detect stronger edges.
    # Experimentation might be needed based on test images.
    edged = cv2.Canny(blurred, 50, 150) 

    # 4. Find Contours
    # Use RETR_LIST and CHAIN_APPROX_SIMPLE for efficiency
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        print("No contours found.")
        return None

    # 5. Filter & Select Contours
    # Sort contours by area (largest first)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10] # Check top 10 largest

    found_strip_contour_points = None # Store the 4 points
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_strip_area or area > max_strip_area:
            # print(f"Contour area {area:.0f} outside range ({min_strip_area:.0f}-{max_strip_area:.0f}). Skipping.")
            continue
            
        # Approximate the contour shape
        peri = cv2.arcLength(c, True)
        # Epsilon: Parameter specifying the approximation accuracy. 
        # Smaller value -> more points, closer to original shape.
        # Larger value -> fewer points, more approximated shape.
        # 0.02 * peri is a common starting point.
        approx = cv2.approxPolyDP(c, 0.03 * peri, True) 

        # Check if the approximation has 4 vertices (is a quadrilateral)
        if len(approx) == 4:
            # Calculate bounding box and aspect ratio
            (x, y, w, h) = cv2.boundingRect(approx)
            aspect_ratio = float(w) / h
            
            # Define expected aspect ratio range (strip is tall and narrow)
            # Or wide and short depending on orientation, allow both
            min_aspect_ratio = 0.1 # e.g., width is 10% of height
            max_aspect_ratio = 10.0 # e.g., width is 10x height (allows horizontal)
            
            is_valid_aspect_ratio = (aspect_ratio >= min_aspect_ratio and aspect_ratio <= 1.0 / min_aspect_ratio)
            
            print(f"Contour 4 vertices. Area: {area:.0f}, Aspect Ratio: {aspect_ratio:.2f}")
            if is_valid_aspect_ratio:
                 found_strip_contour_points = approx # Store the points
                 print("Found potential strip contour meeting aspect ratio criteria.")
                 break # Found a likely candidate
            # else:
                # print(f"Contour has {len(approx)} vertices. Skipping.")

    if found_strip_contour_points is None:
        print("Could not find a suitable 4-vertex contour with valid aspect ratio.")
        return None

    # Return the 4 corner points of the contour
    # Reshape points to be a simple list of (x, y) tuples/lists
    points = found_strip_contour_points.reshape(4, 2)
    print(f"Detected strip contour points: {points.tolist()}")
    return points.astype(np.float32) # Ensure float32 for perspective transform

def align_strip(img, strip_points):
    print("Aligning strip...")
    # strip_points should be the 4x2 numpy array from detect_strip

    # Order the points: tl, tr, br, bl
    rect = order_points(strip_points)
    (tl, tr, br, bl) = rect

    # Compute the width of the new image, which will be the
    # maximum distance between bottom-right and bottom-left
    # x-coordiates or the top-right and top-left x-coordinates
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))

    # Compute the height of the new image, which will be the
    # maximum distance between the top-right and bottom-right
    # y-coordinates or the top-left and bottom-left y-coordinates
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))

    # Now that we have the dimensions of the new image, construct
    # the set of destination points to obtain a "birds eye view",
    # (i.e. top-down view) of the image, again specifying points
    # in the top-left, top-right, bottom-right, and bottom-left order
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]], dtype="float32")

    # Compute the perspective transform matrix and then apply it
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, M, (maxWidth, maxHeight))

    print(f"Perspective warp complete. Output shape: {warped.shape}")
    # Return the warped image and the transformation matrix
    return warped, M

def locate_pads(aligned_img, num_pads=7):
    print("Locating pads using Hough Line Transform...")
    height, width = aligned_img.shape[:2]
    
    # 1. Preprocessing
    gray = cv2.cvtColor(aligned_img, cv2.COLOR_BGR2GRAY)
    # blurred = cv2.GaussianBlur(gray, (3, 3), 0) # Optional blur

    # 2. Edge Detection
    # Might need different thresholds than strip detection, focus on pad edges
    edged = cv2.Canny(gray, 50, 150) 

    # 3. Hough Line Transform to find line segments
    # Parameters: (image, rho_accuracy, theta_accuracy, threshold, min_line_length, max_line_gap)
    # Adjust threshold, minLineLength, maxLineGap based on testing
    min_line_length = width * 0.3 # Line should be at least 30% of strip width
    max_line_gap = width * 0.1   # Max gap between segments of the same line
    lines = cv2.HoughLinesP(edged, 1, np.pi / 180, threshold=20, 
                          minLineLength=min_line_length, maxLineGap=max_line_gap)

    if lines is None:
        print("Warning: No lines found by Hough Transform. Falling back to simple division.")
        # Fallback logic (same as previous placeholder)
        pad_height_approx = height / num_pads
        pad_centers = []
        for i in range(num_pads):
            center_y = int(pad_height_approx * (i + 0.5))
            center_x = int(width * 0.5)
            pad_centers.append((center_x, center_y))
        return pad_centers

    # 4. Filter Lines
    horizontal_lines = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        # Calculate angle
        angle = np.arctan2(y2 - y1, x2 - x1) * 180. / np.pi
        # Check if line is close to horizontal (e.g., within +/- 10 degrees)
        if abs(angle) < 10 or abs(angle - 180) < 10:
            # Check if line is roughly centered horizontally
            center_x = (x1 + x2) / 2
            if center_x > width * 0.2 and center_x < width * 0.8:
                 # Store the average Y coordinate and the line itself for potential clustering
                avg_y = (y1 + y2) / 2
                horizontal_lines.append({'y': avg_y, 'line': line[0]})
    
    if not horizontal_lines:
        print("Warning: No suitable horizontal lines found. Falling back to simple division.")
        # Fallback logic (same as previous placeholder)
        pad_height_approx = height / num_pads
        pad_centers = []
        for i in range(num_pads):
            center_y = int(pad_height_approx * (i + 0.5))
            center_x = int(width * 0.5)
            pad_centers.append((center_x, center_y))
        return pad_centers

    # 5. Group and Select Lines
    # Sort lines by Y coordinate
    horizontal_lines.sort(key=lambda item: item['y'])

    # Cluster nearby lines (simple clustering based on distance)
    clustered_lines_y = []
    if horizontal_lines:
        current_cluster_y = [horizontal_lines[0]['y']]
        last_y = horizontal_lines[0]['y']
        # Heuristic: Cluster lines closer than ~1/10th pad height? 
        # Pad height approx height / (num_pads * ~1.5) to account for gaps? Very rough.
        cluster_threshold = (height / (num_pads + 2)) * 0.1 # Small threshold

        for i in range(1, len(horizontal_lines)):
            y = horizontal_lines[i]['y']
            if abs(y - last_y) < cluster_threshold:
                current_cluster_y.append(y)
            else:
                # Finalize previous cluster
                clustered_lines_y.append(np.mean(current_cluster_y))
                # Start new cluster
                current_cluster_y = [y]
            last_y = y
        # Add the last cluster
        clustered_lines_y.append(np.mean(current_cluster_y))

    print(f"Found {len(clustered_lines_y)} distinct horizontal line clusters.")

    # Select the 8 most likely boundary lines
    # This part is tricky and might need more sophisticated logic or assumptions.
    # Simplistic approach: If we have >= 8 lines, assume they are the boundaries.
    # A better way might involve looking at the spacing between lines.
    
    boundary_lines_y = []
    if len(clustered_lines_y) >= num_pads + 1: # Expect 8 lines for 7 pads
        # Simplistic: Take the first 8 distinct lines found
        # This assumes the top lines are detected correctly and there aren't too many spurious lines
        # Could also try selecting lines with the most consistent spacing in the middle?        
        boundary_lines_y = sorted(clustered_lines_y)[:num_pads + 1]
        print(f"Selected {len(boundary_lines_y)} boundary lines (Y-coords): {[int(y) for y in boundary_lines_y]}")
    else:
        print(f"Warning: Did not find enough distinct horizontal lines ({len(clustered_lines_y)} found, expected {num_pads + 1}). Falling back to simple division.")
        # Fallback logic
        pad_height_approx = height / num_pads
        pad_centers = []
        for i in range(num_pads):
            center_y = int(pad_height_approx * (i + 0.5))
            center_x = int(width * 0.5)
            pad_centers.append((center_x, center_y))
        return pad_centers

    # 6. Calculate Centers
    pad_centers = []
    center_x = int(width * 0.5) # Assume horizontal center
    for i in range(num_pads):
        # Pad center Y is the midpoint between boundary line i and i+1
        center_y = int((boundary_lines_y[i] + boundary_lines_y[i+1]) / 2)
        pad_centers.append((center_x, center_y))

    print(f"Located pad centers: {pad_centers}")
    return pad_centers

def sample_pad_color(img, center, pad_height, default_sample_fraction=0.5, min_sample_size=5, max_sample_size=20):
    print(f"Sampling Pad Color at {center} with est. height {pad_height:.0f}")
    x, y = center
    h, w = img.shape[:2]

    # Determine sample size based on pad height (assume roughly square pads)
    if pad_height > 0:
        sample_size = int(pad_height * default_sample_fraction)
        sample_size = max(min_sample_size, min(sample_size, max_sample_size)) # Clamp size
    else:
        sample_size = min_sample_size # Fallback if height is invalid
    print(f"Using sample size: {sample_size}")

    half_size = sample_size // 2
    x1 = max(0, x - half_size)
    y1 = max(0, y - half_size)
    x2 = min(w, x + half_size)
    y2 = min(h, y + half_size)
    
    if y2 <= y1 or x2 <= x1: # Check bounds *after* calculating coords
         print(f"Warning: Sample area for {center} is invalid or zero size ({x1},{y1} -> {x2},{y2}).")
         return None
    
    sample_area = img[y1:y2, x1:x2]
    if sample_area.size == 0:
        print(f"Warning: Sample area empty for {center}.")
        return None
        
    lab_sample_area = cv2.cvtColor(sample_area, cv2.COLOR_BGR2LAB)
    pixels = lab_sample_area.reshape(-1, 3)
    median_lab = np.median(pixels, axis=0)
    return median_lab.tolist()

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

    # --- Authentication Check --- 
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return 'Unauthorized: Missing or invalid Authorization header', 401
    
    id_token = auth_header.split('Bearer ')[1]
    try:
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        print(f"Authenticated user: {uid}")
    except Exception as e:
        print(f"Token verification failed: {e}")
        return f"Unauthorized: Token verification failed: {e}", 401
    # --- End Authentication Check --- 

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
        
        # 1. Detect Strip
        strip_points = detect_strip(img_original)
        if strip_points is None: # Check if None
            return "Could not detect test strip in image.", 400
            
        # 2. Align/Correct Perspective
        aligned_strip_img, M = align_strip(img_original, strip_points) 
        if aligned_strip_img is None or aligned_strip_img.size == 0:
             return "Failed to align/crop strip.", 500
        print(f"Aligned strip shape: {aligned_strip_img.shape}")

        # 3. Locate Pads
        pad_centers_relative, boundary_lines_y = locate_pads(aligned_strip_img)
        if not pad_centers_relative or len(pad_centers_relative) != 7 or not boundary_lines_y or len(boundary_lines_y) != 8:
             # Added check for boundary lines length
             return f"Could not locate all 7 pads or 8 boundaries reliably.", 400

        parameter_order = [
            "Total Hardness", "Total Chlorine", "Free Chlorine", 
            "Bromine", "Total Alkalinity", "Cyanuric Acid", "pH"
        ]
        calculated_readings = {}
        pad_coordinates_feedback = []

        # 4. Sample Pad Colors & 5. Match Colors
        for i, parameter in enumerate(parameter_order):
            center_relative = pad_centers_relative[i]
            
            # --- Calculate pad height for dynamic sampling --- 
            pad_height_estimate = boundary_lines_y[i+1] - boundary_lines_y[i]
            
            # Sample color using dynamic size
            sampled_lab = sample_pad_color(aligned_strip_img, center_relative, pad_height_estimate) 
            
            matched_value, _ = match_color(sampled_lab, parameter)
            calculated_readings[parameter] = matched_value if matched_value is not None else "N/A"

            # 6. Get Coordinates for Feedback (map back to original image)
            # Use inverse transform M^-1 if perspective correction was applied
            if M is not None:
                # Need to reshape center_relative for perspectiveTransform
                center_relative_arr = np.array([[center_relative]], dtype=np.float32)
                # Calculate inverse matrix
                try:
                    M_inv = np.linalg.inv(M)
                    original_coords = cv2.perspectiveTransform(center_relative_arr, M_inv)
                    original_x = int(original_coords[0][0][0])
                    original_y = int(original_coords[0][0][1])
                except np.linalg.LinAlgError:
                    print("Warning: Could not invert perspective matrix M. Falling back to bbox offset.")
                    # Fallback: Approximate based on bounding box (less accurate if warped)
                    # Need the original bounding box or points here for better fallback
                    # For now, just use relative coords (which is wrong)
                    original_x = center_relative[0] 
                    original_y = center_relative[1]
            else:
                 # Fallback if M is None (e.g., align_strip just cropped)
                 # Get original bounding box from points
                 x_coords = strip_points[:, 0]
                 y_coords = strip_points[:, 1]
                 strip_x = int(np.min(x_coords))
                 strip_y = int(np.min(y_coords))
                 original_x = strip_x + center_relative[0]
                 original_y = strip_y + center_relative[1]
            
            pad_coordinates_feedback.append({
                'parameter': parameter,
                'x': original_x,
                'y': original_y,
                'radius': 5 
            })

        # --- Prepare Response ---
        response_data = {
            'readings': calculated_readings,
            'padCoordinates': pad_coordinates_feedback, 
            'normalRanges': NORMAL_RANGES 
        }
        print("Processing Complete. Response:", response_data)
        return response_data, 200

    except Exception as e:
        print(f"Error processing image: {e}")
        import traceback
        traceback.print_exc() # Print full traceback for debugging
        return 'Internal Server Error processing image', 500 