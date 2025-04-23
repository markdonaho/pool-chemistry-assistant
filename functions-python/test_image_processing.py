import cv2
import numpy as np
from main import detect_strip, align_strip, locate_pads, sample_pad_color, match_color, COLOR_KEY
import os
import traceback # Keep for explicit error printing

def debug_strip_detection(img_to_debug):
    """Debug the strip detection process by saving intermediate images. Expects pre-resized image."""
    print("\nDebugging strip detection (Background Segmentation Attempt - Saving Images)...")

    # Image should already be resized before calling this function
    img_resized = img_to_debug 
    print(f"Using image size: {img_resized.shape} for debugging")
    img_height, img_width = img_resized.shape[:2]

    # Save Original Resized image
    cv2.imwrite("debug_0_resized.png", img_resized)
    print("Saved: debug_0_resized.png")
    
    # 2. Background Segmentation Steps (LAB Distance)
    print("--- Debugging LAB Distance Segmentation ---")
    lab_img = cv2.cvtColor(img_resized, cv2.COLOR_BGR2LAB)
    
    white_point = np.array([100, 0, 0], dtype=np.float32) 
    pixels_lab = lab_img.reshape(-1, 3).astype(np.float32)
    distances = np.linalg.norm(pixels_lab - white_point, axis=1)
    distance_map = distances.reshape(img_height, img_width)
    
    # Save the distance map (normalized for visibility)
    normalized_distance_map = cv2.normalize(distance_map, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    cv2.imwrite("debug_1_lab_distance_map.png", normalized_distance_map)
    print("Saved: debug_1_lab_distance_map.png (Brighter = Further from white)")

    distance_threshold = 50.0
    strip_finger_mask = np.uint8(distance_map > distance_threshold) * 255
    cv2.imwrite("debug_2_strip_finger_mask_initial.png", strip_finger_mask)
    print("Saved: debug_2_strip_finger_mask_initial.png")
    
    # Morphological cleaning (Open then Close)
    kernel_morph_small = np.ones((3,3), np.uint8) 
    kernel_morph_bg = np.ones((10,10), np.uint8) 
    strip_finger_mask_opened = cv2.morphologyEx(strip_finger_mask, cv2.MORPH_OPEN, kernel_morph_small)
    cv2.imwrite("debug_3_strip_finger_mask_opened.png", strip_finger_mask_opened)
    print("Saved: debug_3_strip_finger_mask_opened.png")
    strip_finger_mask_closed = cv2.morphologyEx(strip_finger_mask_opened, cv2.MORPH_CLOSE, kernel_morph_bg)
    cv2.imwrite("debug_4_strip_finger_mask_closed.png", strip_finger_mask_closed)
    print("Saved: debug_4_strip_finger_mask_closed.png")

    # Find largest contour in the cleaned mask
    contours_sf, _ = cv2.findContours(strip_finger_mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Create final ROI mask (black bg, white largest contour)
    roi_mask = np.zeros(img_resized.shape[:2], dtype="uint8") 
    largest_sf_contour_drawn = img_resized.copy() # For visualization
    if contours_sf:
        largest_sf_contour = max(contours_sf, key=cv2.contourArea)
        cv2.drawContours(largest_sf_contour_drawn, [largest_sf_contour], -1, (255,0,0), 3) # Draw blue outline
        if cv2.contourArea(largest_sf_contour) > (img_width * img_height * 0.01):
             cv2.drawContours(roi_mask, [largest_sf_contour], -1, 255, -1) # Fill white in roi_mask
        else:
             roi_mask = np.ones(img_resized.shape[:2], dtype="uint8") * 255 # Fallback
    else:
        roi_mask = np.ones(img_resized.shape[:2], dtype="uint8") * 255 # Fallback
        
    cv2.imwrite("debug_5_largest_strip_finger_contour.png", largest_sf_contour_drawn)
    print("Saved: debug_5_largest_strip_finger_contour.png")
    cv2.imwrite("debug_6_roi_mask_final.png", roi_mask)
    print("Saved: debug_6_roi_mask_final.png")

    # 3. Process within ROI (L-channel)
    print("--- Debugging Processing within ROI ---")
    l, a, b = cv2.split(lab_img)
    l_masked = cv2.bitwise_and(l, l, mask=roi_mask)
    cv2.imwrite("debug_7_l_channel_masked.png", l_masked)
    print("Saved: debug_7_l_channel_masked.png")

    # 4. Adaptive Thresholding on Masked L-channel
    thresh = cv2.adaptiveThreshold(l_masked, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, \
                                 cv2.THRESH_BINARY_INV, blockSize=51, C=1)
    thresh = cv2.bitwise_and(thresh, thresh, mask=roi_mask) # Mask again
    cv2.imwrite("debug_8_adaptive_thresh_masked.png", thresh)
    print("Saved: debug_8_adaptive_thresh_masked.png")

    # 5. Morphological Operations
    kernel_morph_strip = np.ones((5,5), np.uint8)
    morph_close = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel_morph_strip)
    cv2.imwrite("debug_9_morph_close.png", morph_close)
    print("Saved: debug_9_morph_close.png") 
    morph_open = cv2.morphologyEx(morph_close, cv2.MORPH_OPEN, kernel_morph_strip)
    cv2.imwrite("debug_10_morph_open_final.png", morph_open)
    print("Saved: debug_10_morph_open_final.png")

    # 6. Find and draw contours found in the *final* processed image
    contours_final, _ = cv2.findContours(morph_open.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    contour_img_final = img_resized.copy()
    cv2.drawContours(contour_img_final, contours_final, -1, (0, 255, 0), 2)
    cv2.imwrite("debug_11_all_final_contours.png", contour_img_final)
    print("Saved: debug_11_all_final_contours.png")
    
    # Draw top 5 largest final contours
    top_contours_final = sorted(contours_final, key=cv2.contourArea, reverse=True)[:5]
    top_contour_img_final = img_resized.copy()
    cv2.drawContours(top_contour_img_final, top_contours_final, -1, (0, 0, 255), 2)
    cv2.imwrite("debug_12_top5_final_contours.png", top_contour_img_final)
    print("Saved: debug_12_top5_final_contours.png")

    # Print info about top 5 final contours for debugging
    min_strip_area = img_height * img_width * 0.05
    max_strip_area = img_height * img_width * 0.50
    print("\n--- Top 5 Final Contour Analysis (Post-BG Removal) ---")
    print(f"Area Range Check: Min={min_strip_area:.0f}, Max={max_strip_area:.0f}")
    if not top_contours_final:
        print("No final contours found to analyze.")
    else:
        for i, c in enumerate(top_contours_final):
            area = cv2.contourArea(c)
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.03 * peri, True)
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
    
    print(f"Image loaded successfully. Original Shape: {img.shape}")

    # --- Resize image ONCE for the whole test --- 
    target_width = 800.0
    original_width = img.shape[1]
    img_resized = None # Initialize
    if original_width > target_width:
        scale = target_width / original_width
        target_height = int(img.shape[0] * scale)
        img_resized = cv2.resize(img, (int(target_width), target_height), interpolation=cv2.INTER_AREA)
        print(f"Resized image to: {img_resized.shape} for testing")
    else:
        print(f"Image already smaller than target width ({original_width}px). Using original size.")
        img_resized = img 
    # --- End Resize ---

    # Debug strip detection - Pass the resized image
    debug_strip_detection(img_resized)
    
    # 2. Detect strip (Pass the ORIGINAL image to detect_strip)
    try:
        strip_points = detect_strip(img)

        if strip_points is None:
            print("Error: Failed to detect strip (even with relaxed criteria).")
            return
        print("Strip 'detected' (using relaxed criteria possibly).")
        
        # Save final detected shape overlayed on the RESIZED image for visualization consistency
        final_detection_img_resized = img_resized.copy() # Use the already resized image
        
        pts_int = strip_points.astype(int)
        if len(pts_int) == 4:
            cv2.polylines(final_detection_img_resized, [pts_int], isClosed=True, color=(0,0,255), thickness=3)
            for point in pts_int:
                cv2.circle(final_detection_img_resized, tuple(point), 5, (0, 0, 255), -1)
        else: # Should not happen if detect_strip guarantees 4 points (bbox fallback)
            for point in pts_int:
               cv2.circle(final_detection_img_resized, tuple(point), 5, (0, 255, 255), -1)
        cv2.imwrite("debug_13_final_detected_shape.png", final_detection_img_resized)
        print("Saved: debug_13_final_detected_shape.png")

    except Exception as e:
        print(f"Error in detect_strip: {str(e)}")
        traceback.print_exc()
        return
    
    # 3. Align strip (Use the RESIZED image)
    try:
        aligned_img, transform_matrix = align_strip(img_resized, strip_points)
        if aligned_img is None:
            print("Error: Failed to align strip")
            return
        print("Strip aligned successfully")
        cv2.imwrite("debug_14_aligned_strip.png", aligned_img)
        print("Saved: debug_14_aligned_strip.png")
    except Exception as e:
        print(f"Error in align_strip: {str(e)}")
        traceback.print_exc()
        return
    
    # 4. Locate pads (Use the ALIGNED image)
    try:
        # Make sure aligned_img exists before proceeding
        if aligned_img is None:
            print("Cannot locate pads because alignment failed or was skipped.")
            return 
        # ... Pad location logic ...
        # We should also save the image with located pads drawn
        pad_order = [
            "Total Hardness", "Total Chlorine", "Free Chlorine", "pH",
            "Total Alkalinity", "Cyanuric Acid", "Bromine"
        ]
        num_pads = len(pad_order)
        
        aligned_height, aligned_width = aligned_img.shape[:2]
        if aligned_height < aligned_width:
            print("Aligned strip appears horizontal. Rotating 90 degrees for pad detection.")
            aligned_img = cv2.rotate(aligned_img, cv2.ROTATE_90_CLOCKWISE)
            aligned_height, aligned_width = aligned_img.shape[:2]

        pad_locations = locate_pads(aligned_img, num_pads=num_pads)
        if pad_locations is None:
            print("Error: Could not locate test pads (using estimation method).")
            # Save the aligned image for inspection
            cv2.imwrite("debug_15_locate_pads_failed_on_this.png", aligned_img)
            print("Saved: debug_15_locate_pads_failed_on_this.png")
            return
            
        pad_centers, pad_heights = pad_locations

        if len(pad_centers) != num_pads or len(pad_heights) != num_pads:
             print(f"Error: Incorrect number of pads located ({len(pad_centers)}). Expected {num_pads}.")
             # Save image with located pads drawn for inspection
             pads_drawn_img = aligned_img.copy()
             for center in pad_centers:
                cv2.circle(pads_drawn_img, center, 5, (0, 255, 0), -1)
             cv2.imwrite("debug_15_locate_pads_wrong_count.png", pads_drawn_img)
             print("Saved: debug_15_locate_pads_wrong_count.png")
             return
        else:
            # Draw located pads on the aligned image and save
            pads_drawn_img = aligned_img.copy()
            for i, center in enumerate(pad_centers):
                cv2.circle(pads_drawn_img, center, 5, (0, 255, 0), -1)
                cv2.putText(pads_drawn_img, str(i+1), (center[0]+10, center[1]+5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 2)
            cv2.imwrite("debug_15_located_pads.png", pads_drawn_img)
            print("Saved: debug_15_located_pads.png")

    except Exception as e:
        print(f"Error in locate_pads: {str(e)}")
        traceback.print_exc()
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
    test_image_path = "TestStrip.jpg" 
    test_image_processing(test_image_path) 