# Python Cloud Functions
import functions_framework
import firebase_admin
from firebase_admin import initialize_app, auth # <<< Add auth here
import numpy as np # Keep imports to see if they cause timeout
import cv2         # Keep imports to see if they cause timeout
import os
import math
import traceback # Keep this for error logging
from flask import make_response, request # Keep request import
import asyncio # <<< Import asyncio

# Initialize Firebase Admin SDK (if not already initialized)
try:
    if not firebase_admin._apps:
        initialize_app()
except ValueError as e:
    print(f"Firebase Admin SDK already initialized? {e}")


# --- Define Color Key (Using pre-calculated LAB values) ---
# Keep this - it's just data assignment
COLOR_KEY = {
    "Total Hardness": [
        {"lab": [47, -11, 5], "value": 0},
        {"lab": [46, 12, -1], "value": 25},
        {"lab": [46, 19, 0], "value": 50},
        {"lab": [49, 19, -1], "value": 120},
        {"lab": [51, 24, 0], "value": 250},
        {"lab": [52, 29, 1], "value": 425}
    ],
    "Total Chlorine": [
        {"lab": [99, -6, 26], "value": 0},
        {"lab": [98, -11, 23], "value": 0.5},
        {"lab": [93, -14, 23], "value": 1},
        {"lab": [89, -19, 27], "value": 3},
        {"lab": [84, -21, 25], "value": 5},
        {"lab": [76, -29, 10], "value": 10},
        {"lab": [72, -32, 6], "value": 20}
    ],
    "Free Chlorine": [
        {"lab": [100, 0, 0], "value": 0},
        {"lab": [96, 7, -1], "value": 0.5},
        {"lab": [91, 14, -1], "value": 1},
        {"lab": [73, 35, -10], "value": 3},
        {"lab": [59, 41, -10], "value": 5},
        {"lab": [52, 34, -4], "value": 10},
        {"lab": [46, 29, -3], "value": 20}
    ],
    "Bromine": [
        {"lab": [100, 0, 0], "value": 0},
        {"lab": [96, 7, -1], "value": 1},
        {"lab": [91, 14, -1], "value": 2},
        {"lab": [73, 35, -10], "value": 6},
        {"lab": [59, 41, -10], "value": 10},
        {"lab": [52, 34, -4], "value": 20},
        {"lab": [46, 29, -3], "value": 40}
    ],
    "Total Alkalinity": [
        {"lab": [96, -5, 32], "value": 0},
        {"lab": [93, -24, 25], "value": 40},
        {"lab": [80, -29, 24], "value": 80},
        {"lab": [67, -32, 18], "value": 120},
        {"lab": [57, -30, 8], "value": 180},
        {"lab": [47, -26, 2], "value": 240},
        {"lab": [40, -21, 0], "value": 360}
    ],
    "Cyanuric Acid": [
        {"lab": [86, 10, 26], "value": 0},
        {"lab": [83, 11, 25], "value": 40},
        {"lab": [79, 14, 26], "value": 100},
        {"lab": [76, 16, 25], "value": 150},
        {"lab": [72, 19, 23], "value": 240}
    ],
     "pH": [
        {"lab": [79, 25, 29], "value": 6.2},
        {"lab": [75, 30, 32], "value": 6.8},
        {"lab": [71, 36, 34], "value": 7.2},
        {"lab": [66, 42, 36], "value": 7.8},
        {"lab": [61, 48, 37], "value": 8.4},
        {"lab": [57, 52, 37], "value": 9.0}
    ]
}

# --- Define Normal Ranges (Based on Green Bars) ---
# Keep this - it's just data assignment
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

# --- Uncommented Helper Functions ---
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

def detect_strip(img):
    print("Detecting strip...")
    
    # --- Resize image --- 
    target_width = 800.0
    scale = target_width / img.shape[1]
    target_height = int(img.shape[0] * scale)
    img_resized = cv2.resize(img, (int(target_width), target_height), interpolation=cv2.INTER_AREA)
    print(f"Resized image to: {img_resized.shape}")
    img_height, img_width = img_resized.shape[:2]

    # --- 1. Background Segmentation (using LAB distance from White) ---
    print("Segmenting non-white areas (background/fingers) using LAB distance...")
    lab_img = cv2.cvtColor(img_resized, cv2.COLOR_BGR2LAB)
    
    # Reference white point in LAB
    white_point = np.array([100, 0, 0], dtype=np.float32) 
    
    # Calculate distance for each pixel
    # Reshape for easier calculation
    pixels_lab = lab_img.reshape(-1, 3).astype(np.float32)
    distances = np.linalg.norm(pixels_lab - white_point, axis=1)
    
    # Reshape distances back into image shape
    distance_map = distances.reshape(img_height, img_width)

    # Threshold the distance map - pixels FAR from white are foreground (255)
    distance_threshold = 50.0 
    strip_finger_mask = np.uint8(distance_map > distance_threshold) * 255
    
    # Clean up the mask - Opening first to remove noise, then Closing to fill gaps
    kernel_morph_small = np.ones((3,3), np.uint8) # Smaller kernel for opening
    kernel_morph_bg = np.ones((10,10), np.uint8) 
    strip_finger_mask_opened = cv2.morphologyEx(strip_finger_mask, cv2.MORPH_OPEN, kernel_morph_small)
    strip_finger_mask_closed = cv2.morphologyEx(strip_finger_mask_opened, cv2.MORPH_CLOSE, kernel_morph_bg)

    # Find contours in the cleaned mask (areas far from white)
    contours_sf, _ = cv2.findContours(strip_finger_mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Create the ROI mask: Start black, draw only the largest contour (strip/fingers) white
    roi_mask = np.zeros(img_resized.shape[:2], dtype="uint8") # Start with all black
    if contours_sf:
        largest_sf_contour = max(contours_sf, key=cv2.contourArea)
        # Check if the largest area is significant (e.g., >1% of image to avoid noise blobs)
        if cv2.contourArea(largest_sf_contour) > (img_width * img_height * 0.01):
            print("Largest strip/finger contour found, creating ROI mask...")
            # Draw this largest contour filled white onto the roi_mask
            cv2.drawContours(roi_mask, [largest_sf_contour], -1, 255, -1) # White fill
        else:
            print("Largest strip/finger contour is too small, likely noise. ROI mask will be empty.")
            roi_mask = np.ones(img_resized.shape[:2], dtype="uint8") * 255 # Fallback: use full image if strip not found
    else:
        print("No significant strip/finger contours found from distance map. ROI mask empty.")
        roi_mask = np.ones(img_resized.shape[:2], dtype="uint8") * 255 # Fallback: use full image
        
    # roi_mask should now contain only the main strip/finger area as white
    # --- End Background Segmentation ---

    # --- 2. Process within ROI (using original L-channel) ---
    print("Processing L-channel within ROI (strip area)...")
    l, a, b = cv2.split(lab_img) # Split the LAB image we already have
    
    # Apply the ROI mask to the L-channel
    l_masked = cv2.bitwise_and(l, l, mask=roi_mask)

    # --- 3. Adaptive Thresholding on Masked L-channel ---
    # Use previous parameters (51, 1), as they might work better without the background interference
    thresh = cv2.adaptiveThreshold(l_masked, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                 cv2.THRESH_BINARY_INV, blockSize=51, C=1) 
    # Important: Apply the ROI mask AGAIN after thresholding to remove noise introduced at the edges
    thresh = cv2.bitwise_and(thresh, thresh, mask=roi_mask)

    # --- 4. Morphological Operations on Thresholded Image ---
    kernel_morph_strip = np.ones((5,5), np.uint8) # Original 5x5 kernel might be fine now
    morph = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel_morph_strip)
    morph = cv2.morphologyEx(morph, cv2.MORPH_OPEN, kernel_morph_strip)

    # --- 5. Find Contours in Processed Image ---
    contours_final, _ = cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours_final:
        print("No final contours found after processing within ROI.")
        return None

    # --- 6. Relaxed Contour Selection (within area bounds) ---
    min_strip_area = img_height * img_width * 0.05  # 5% of resized image
    max_strip_area = img_height * img_width * 0.50  # 50% of resized image
    contours_final = sorted(contours_final, key=cv2.contourArea, reverse=True)[:5] # Check top 5 largest

    found_strip_contour_points = None
    selected_contour_for_debug = None

    print("\n--- Relaxed Contour Selection (Post-BG Removal) ---")
    for c in contours_final:
        area = cv2.contourArea(c)
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.03 * peri, True) # Epsilon from previous attempt

        print(f"Checking contour: Area={area:.0f}, Vertices={len(approx)}")
        if area >= min_strip_area and area <= max_strip_area:
            print(">>> Found contour within area bounds. Selecting this one.")
            found_strip_contour_points = approx 
            selected_contour_for_debug = c 
            break 
        else:
            print(f"   Area {area:.0f} outside range ({min_strip_area:.0f}-{max_strip_area:.0f}). Skipping.")

    if found_strip_contour_points is None:
        print("Could not find ANY contour within the specified area range (Post-BG Removal).")
        return None

    # Fallback logic if approx does not have 4 vertices
    if len(found_strip_contour_points) != 4:
        print(f"Warning: Selected contour approximation has {len(found_strip_contour_points)} vertices, not 4. Falling back to bounding rectangle for alignment.")
        x, y, w, h = cv2.boundingRect(selected_contour_for_debug) 
        points = np.array([
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h]
        ], dtype=np.float32)
        print(f"Detected strip approx points (from bounding box): {points.tolist()}")
        return points
    else:
        # Original logic if we found 4 points
        points = found_strip_contour_points.reshape(4, 2)
        print(f"Detected strip approx points (vertices={len(found_strip_contour_points)}): {points.tolist()}")
        return points.astype(np.float32)

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
    # Ensure input is grayscale
    if len(aligned_img.shape) == 3:
        gray = cv2.cvtColor(aligned_img, cv2.COLOR_BGR2GRAY)
    else:
        gray = aligned_img

    # --- Parameters for Hough Line Transform ---
    rho = 1
    theta = np.pi / 180
    threshold = 60     # Increased from 50
    min_line_length = 40 # Decreased from 50
    max_line_gap = 10    # Kept at 10
    # --- End Parameters ---

    # Enhance edges specifically for horizontal/vertical lines if needed
    # Using a Sobel filter might help emphasize the pad edges
    # grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    # grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    # abs_grad_x = cv2.convertScaleAbs(grad_x)
    # abs_grad_y = cv2.convertScaleAbs(grad_y)
    # edges = cv2.addWeighted(abs_grad_x, 0.5, abs_grad_y, 0.5, 0) # Combine gradients
    
    # Use Canny edge detection with adjusted thresholds
    edges = cv2.Canny(gray, 30, 100, apertureSize=3) # Lowered thresholds from 50, 150

    # Detect lines using Hough Line Transform
    lines = cv2.HoughLinesP(edges, rho, theta, threshold, np.array([]),
                            min_line_length, max_line_gap)

    if lines is None:
        print("Hough Line Transform did not detect any lines.")
        return None

    print(f"Hough Transform detected {len(lines)} line segments initially.")

    # --- Filter and Cluster Lines ---
    horizontal_lines = []
    vertical_lines = []
    img_height, img_width = gray.shape
    angle_tolerance_degrees = 5 # Allow lines within 5 degrees of horizontal/vertical
    angle_tolerance_rad = np.deg2rad(angle_tolerance_degrees)

    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = math.atan2(y2 - y1, x2 - x1)

        # Check if line is approximately horizontal
        if abs(angle) < angle_tolerance_rad or abs(abs(angle) - np.pi) < angle_tolerance_rad:
            # Add the average y-coordinate for clustering horizontal lines
            horizontal_lines.append(((y1 + y2) / 2, line[0]))
        # Check if line is approximately vertical
        elif abs(abs(angle) - np.pi / 2) < angle_tolerance_rad:
            # Add the average x-coordinate for clustering vertical lines
            vertical_lines.append(((x1 + x2) / 2, line[0]))

    print(f"Filtered lines: {len(horizontal_lines)} horizontal, {len(vertical_lines)} vertical candidates.")

    # --- Clustering (Simple approach: average position) ---
    # This is a very basic clustering. More robust methods (DBSCAN, KMeans) might be needed.
    # For now, let's assume the major horizontal lines define pad boundaries.
    
    if not horizontal_lines:
        print("No horizontal lines found after filtering.")
        return None

    # Sort horizontal lines by their y-coordinate
    horizontal_lines.sort(key=lambda item: item[0])

    # --- Find Average Pad Boundaries from Horizontal Lines ---
    # We expect num_pads + 1 horizontal boundary lines (top of first pad to bottom of last pad)
    # We need to cluster the y-coordinates to find the dominant horizontal lines.

    # Simple clustering: Group lines that are close together
    y_coords = [y for y, _ in horizontal_lines]
    clusters = []
    if y_coords:
        current_cluster = [y_coords[0]]
        for i in range(1, len(y_coords)):
            # If the next y is close to the last one in the current cluster
            if y_coords[i] - current_cluster[-1] < max_line_gap * 2: # Heuristic gap threshold
                current_cluster.append(y_coords[i])
            else:
                # Average the cluster and start a new one
                clusters.append(np.mean(current_cluster))
                current_cluster = [y_coords[i]]
        clusters.append(np.mean(current_cluster)) # Add the last cluster

    print(f"Found {len(clusters)} distinct horizontal line clusters (potential pad boundaries) at y-coords: {[f'{c:.1f}' for c in clusters]}")

    # We need exactly num_pads + 1 boundaries
    if len(clusters) != num_pads + 1:
        print(f"Warning: Expected {num_pads + 1} horizontal boundaries, but found {len(clusters)}. Adjust Hough parameters or clustering.")
        # Attempt to select the most plausible boundaries if too many/few found?
        # For now, return None if the count is wrong.
        return None

    pad_boundaries_y = sorted(clusters)

    # --- Determine Pad Center X (Assume centered in the image) ---
    # A more robust method would use vertical lines or other features.
    center_x = img_width / 2

    # --- Calculate Pad Centers and Heights ---
    pad_centers = []
    pad_heights = []
    for i in range(num_pads):
        y_top = pad_boundaries_y[i]
        y_bottom = pad_boundaries_y[i+1]
        center_y = (y_top + y_bottom) / 2
        height = y_bottom - y_top
        pad_centers.append((int(center_x), int(center_y)))
        pad_heights.append(int(height))
        print(f"Pad {i+1}: Center=({int(center_x)}, {int(center_y)}), Height={int(height)}")

    return pad_centers, pad_heights


def sample_pad_color(img, center, pad_height, default_sample_fraction=0.5, min_sample_size=5, max_sample_size=20):
    print(f"Sampling pad color around center {center} with height {pad_height}")
    center_x, center_y = center

    # Calculate sample area size based on pad height
    sample_size = int(pad_height * default_sample_fraction)
    # Clamp sample size to min/max bounds
    sample_size = max(min_sample_size, min(sample_size, max_sample_size))
    half_size = sample_size // 2

    # Define the sampling region (ROI - Region of Interest)
    y_start = max(0, center_y - half_size)
    y_end = min(img.shape[0], center_y + half_size)
    x_start = max(0, center_x - half_size)
    x_end = min(img.shape[1], center_x + half_size)

    # Ensure the ROI is valid
    if y_start >= y_end or x_start >= x_end:
        print(f"Warning: Invalid sampling ROI calculated for center {center}. Skipping.")
        return None

    roi = img[y_start:y_end, x_start:x_end]

    # --- Color Calculation ---
    # 1. Convert ROI to LAB color space (better for color difference)
    try:
        lab_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
    except cv2.error as e:
        print(f"Error converting ROI to LAB: {e}. ROI shape: {roi.shape}, Center: {center}, Size: {sample_size}")
        # If the ROI is tiny or invalid, conversion might fail
        return None

    # 2. Calculate the average LAB value
    # Reshape to a list of pixels, then calculate mean over the 0-axis
    pixels = lab_roi.reshape(-1, 3)
    avg_lab = np.mean(pixels, axis=0)

    print(f"Sampled ROI [{y_start}:{y_end}, {x_start}:{x_end}], Average LAB: {avg_lab.tolist()}")
    return avg_lab.tolist() # Return as [L, A, B]


# --- Color Matching Function ---
def match_color(sampled_lab, parameter_key):
    # parameter_key is e.g., COLOR_KEY["pH"]

    if sampled_lab is None:
        return {"value": None, "is_normal": None, "error": "Invalid sample color"}

    # Find the closest color in the key using Euclidean distance in LAB space
    min_dist = float('inf')
    closest_match = None

    for entry in parameter_key:
        key_lab = np.array(entry["lab"])
        dist = np.linalg.norm(np.array(sampled_lab) - key_lab)

        if dist < min_dist:
            min_dist = dist
            closest_match = entry

    if closest_match:
        matched_value = closest_match["value"]
        print(f"Closest match found: Value={matched_value}, LAB={closest_match['lab']}, Distance={min_dist:.2f}")
        # Basic interpolation (needs improvement)
        # Find the two closest points for potential interpolation
        # This requires sorting the key by LAB distance or value first.
        # For now, just return the closest discrete value.
        return {"value": matched_value, "distance": min_dist}
    else:
        print("Could not find any color match.")
        return {"value": None, "is_normal": None, "error": "No color match found"}

# --- NEW Helper Function ---
async def validate_token(request):
    """Validates the Firebase ID token from the Authorization header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise ValueError("Missing or invalid Authorization header")

    token = auth_header.split("Bearer ")[1]
    try:
        # Verify the ID token while checking if the token is revoked.
        decoded_token = await auth.verify_id_token(token, check_revoked=True)
        uid = decoded_token['uid']
        print(f"Token validated successfully for UID: {uid}")
        return uid
    except auth.RevokedIdTokenError:
        # Token has been revoked. Inform the user to reauthenticate or signOut().
        raise ValueError("ID token has been revoked.")
    except auth.UserDisabledError:
        # Token belongs to a disabled user account.
        raise ValueError("User account is disabled.")
    except auth.InvalidIdTokenError as e:
        # Token is invalid for other reasons.
        raise ValueError(f"Token verification failed: {e}")
    except Exception as e:
        # Catch any other unexpected errors during validation
        raise ValueError(f"Unexpected error during token validation: {e}")

# --- Main Cloud Function (Modified to be SYNCHRONOUS) --- #
@functions_framework.http
def process_test_strip(request): # <<< REMOVE async here

    # === CORS Preflight Handling ===
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '3600'
    }
    if request.method == 'OPTIONS':
        return make_response('', 204, cors_headers)
    # === End CORS Preflight Handling ===

    # --- Authentication Check ---
    try:
        # Run the async validation function synchronously
        uid = asyncio.run(validate_token(request)) # <<< Use asyncio.run()
    except ValueError as e:
        print(f"Authentication error: {e}")
        return make_response(f"Unauthorized: {e}", 401, cors_headers)
    except Exception as e:
        print(f"Unexpected authentication error: {e}")
        return make_response("Internal Server Error during authentication", 500, cors_headers)
    # --- End Authentication Check ---

    # --- Original Function Body (remains synchronous) ---
    if 'file' not in request.files:
        return make_response('No file part in the request', 400, cors_headers)

    file = request.files['file']

    if file.filename == '':
        return make_response('No selected file', 400, cors_headers)

    if file:
        try:
            print("Received file. Reading image...")
            # Read image file directly into OpenCV
            # Read the file stream into a numpy array
            filestr = file.read()
            npimg = np.frombuffer(filestr, np.uint8)
            # Decode the numpy array into an image
            img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

            if img is None:
                print("Error: Could not decode image.")
                return make_response("Could not decode image", 400, cors_headers)

            print(f"Image decoded successfully. Shape: {img.shape}")

            # 1. Detect the test strip boundaries
            strip_points = detect_strip(img)
            if strip_points is None:
                print("Error: Test strip not detected.")
                return make_response("Test strip not detected", 400, cors_headers)

            # 2. Align the strip (perspective correction)
            aligned_strip, _ = align_strip(img, strip_points)
            if aligned_strip is None:
                print("Error: Failed to align strip.")
                return make_response("Failed to align strip", 400, cors_headers)

            # 3. Locate the individual test pads
            # Pad order corresponds to COLOR_KEY order (visually from image)
            pad_order = [
                "Total Hardness", "Total Chlorine", "Free Chlorine", "pH",
                "Total Alkalinity", "Cyanuric Acid", "Bromine"
            ]
            num_pads = len(pad_order)

            # Adjust locate_pads to handle potential vertical orientation
            # Check aspect ratio of aligned_strip. If height > width, it's likely vertical.
            aligned_height, aligned_width = aligned_strip.shape[:2]
            if aligned_height < aligned_width:
                print("Aligned strip appears horizontal. Rotating 90 degrees.")
                aligned_strip = cv2.rotate(aligned_strip, cv2.ROTATE_90_CLOCKWISE)
                aligned_height, aligned_width = aligned_strip.shape[:2] # Update dimensions

            pad_locations = locate_pads(aligned_strip, num_pads=num_pads)
            if pad_locations is None:
                print("Error: Could not locate test pads.")
                return make_response("Could not locate test pads", 400, cors_headers)

            pad_centers, pad_heights = pad_locations

            # Ensure we got the expected number of pads
            if len(pad_centers) != num_pads or len(pad_heights) != num_pads:
                print(f"Error: Expected {num_pads} pads, but found {len(pad_centers)} centers and {len(pad_heights)} heights.")
                return make_response(f"Could not locate all {num_pads} test pads accurately.", 400, cors_headers)

            # 4. Sample color from each pad
            results = {}
            print("\n--- Sampling Pad Colors ---")
            for i, param_name in enumerate(pad_order):
                print(f"Processing: {param_name} (Pad {i+1})")
                center = pad_centers[i]
                height = pad_heights[i]
                sampled_lab = sample_pad_color(aligned_strip, center, height)

                if sampled_lab is None:
                    print(f"-> Failed to sample color for {param_name}")
                    results[param_name] = {"value": None, "is_normal": None, "error": "Sampling failed"}
                    continue

                # 5. Match color to the key and determine value
                parameter_key = COLOR_KEY.get(param_name)
                if not parameter_key:
                    print(f"-> Error: No color key found for parameter: {param_name}")
                    results[param_name] = {"value": None, "is_normal": None, "error": f"Missing color key for {param_name}"}
                    continue

                match_result = match_color(sampled_lab, parameter_key)

                # 6. Check if the value is within the normal range
                normal_range = NORMAL_RANGES.get(param_name)
                is_normal = None
                if match_result.get("value") is not None and normal_range:
                    is_normal = normal_range["min"] <= match_result["value"] <= normal_range["max"]
                
                results[param_name] = {
                    "value": match_result.get("value"),
                    "is_normal": is_normal,
                    "sampled_lab": sampled_lab, # Include for debugging
                    "match_distance": match_result.get("distance") # Include for debugging
                }
                print(f"-> Matched Value: {results[param_name]['value']}, Normal: {results[param_name]['is_normal']}\n")

            print("--- Processing Complete ---")
            return make_response(results, 200, cors_headers) # Make sure 'results' is defined before this line

        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            traceback.print_exc() # Log the full stack trace
            return make_response(f"Internal server error: {e}", 500, cors_headers)

    return make_response('File not processed', 400, cors_headers) 