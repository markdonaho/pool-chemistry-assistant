import cv2
import numpy as np
from main import detect_strip, align_strip, locate_pads, sample_pad_color, match_color, COLOR_KEY
import os

def show_image(title, img, wait=True):
    """Helper function to display images during debugging"""
    cv2.imshow(title, img)
    if wait:
        cv2.waitKey(0)
        cv2.destroyAllWindows()

def debug_strip_detection(img):
    """Debug the strip detection process with visualization"""
    print("\nDebugging strip detection (using updated main.py logic)...")
    
    # 1. Original image
    show_image("Original", img, wait=False) # Show original, don't wait yet
    
    # 2. Convert to LAB and show L-channel
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    show_image("L-Channel (LAB)", l, wait=False)
    
    # 3. Adaptive Thresholding
    thresh = cv2.adaptiveThreshold(l, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                 cv2.THRESH_BINARY_INV, 11, 2)
    show_image("Adaptive Threshold", thresh, wait=False)

    # 4. Morphological Operations (Closing then Opening)
    kernel = np.ones((5,5), np.uint8)
    morph_close = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    show_image("Morph Close", morph_close, wait=False) 
    morph_open = cv2.morphologyEx(morph_close, cv2.MORPH_OPEN, kernel)
    show_image("Morph Open (Final for Contours)", morph_open) # Wait after the final processing step

    # 5. Find and draw contours on the original image
    contours, _ = cv2.findContours(morph_open.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        print("No contours found in the morph image.")
        cv2.destroyAllWindows() # Close any open windows
        return

    # Draw all external contours found in the morph image
    contour_img_all = img.copy()
    cv2.drawContours(contour_img_all, contours, -1, (0, 255, 0), 2)
    show_image("All External Contours on Original", contour_img_all, wait=False)
    
    # Draw top 5 largest contours
    top_contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    top_contour_img = img.copy()
    cv2.drawContours(top_contour_img, top_contours, -1, (0, 0, 255), 2)
    show_image("Top 5 Largest Contours on Original", top_contour_img) # Wait after this one

    # Print info about top 5 contours for debugging
    img_height, img_width = img.shape[:2]
    min_strip_area = img_height * img_width * 0.05
    max_strip_area = img_height * img_width * 0.50
    print("\n--- Top 5 Contour Analysis ---")
    print(f"Area Range Check: Min={min_strip_area:.0f}, Max={max_strip_area:.0f}")
    for i, c in enumerate(top_contours):
        area = cv2.contourArea(c)
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        vertices = len(approx)
        (x, y, w, h) = cv2.boundingRect(approx)
        aspect_ratio = float(w) / h if h > 0 else 0
        print(f"Contour {i+1}: Area={area:.0f}, Vertices={vertices}, AspectRatio={aspect_ratio:.2f}")

def test_image_processing(image_path):
    """
    Test the complete image processing pipeline on a single image
    """
    print(f"\nTesting image: {image_path}")
    
    # 1. Load image
    if not os.path.exists(image_path):
        print(f"Error: Image not found at {image_path}")
        return
    
    img = cv2.imread(image_path)
    if img is None:
        print("Error: Failed to load image")
        return
    
    print(f"Image loaded successfully. Shape: {img.shape}")
    
    # Debug strip detection
    debug_strip_detection(img)
    
    # 2. Detect strip
    try:
        strip_points = detect_strip(img)
        if strip_points is None:
            print("Error: Failed to detect strip")
            return
        print("Strip detected successfully")
        
        # Draw detected strip points
        points_img = img.copy()
        for point in strip_points:
            cv2.circle(points_img, (int(point[0]), int(point[1])), 5, (0, 0, 255), -1)
        show_image("Detected Strip Points", points_img)
    except Exception as e:
        print(f"Error in detect_strip: {str(e)}")
        return
    
    # 3. Align strip
    try:
        aligned_img = align_strip(img, strip_points)
        if aligned_img is None:
            print("Error: Failed to align strip")
            return
        print("Strip aligned successfully")
    except Exception as e:
        print(f"Error in align_strip: {str(e)}")
        return
    
    # 4. Locate pads
    try:
        pad_centers = locate_pads(aligned_img)
        if not pad_centers:
            print("Error: Failed to locate pads")
            return
        print(f"Pads located successfully. Found {len(pad_centers)} pads")
    except Exception as e:
        print(f"Error in locate_pads: {str(e)}")
        return
    
    # 5. Sample and match colors for each pad
    for i, center in enumerate(pad_centers):
        try:
            # Sample color
            sampled_lab = sample_pad_color(aligned_img, center, pad_height=30)
            if sampled_lab is None:
                print(f"Error: Failed to sample color for pad {i}")
                continue
            
            # Match color for each parameter
            for param_name in COLOR_KEY.keys():
                try:
                    value = match_color(sampled_lab, COLOR_KEY[param_name])
                    print(f"Pad {i} - {param_name}: {value}")
                except Exception as e:
                    print(f"Error matching color for {param_name}: {str(e)}")
        except Exception as e:
            print(f"Error processing pad {i}: {str(e)}")

if __name__ == "__main__":
    # Test with a sample image
    test_image_path = "TestStrip.jpg"  # Updated to match the actual image name
    test_image_processing(test_image_path) 