UI evidence audit for: docs/dev/qa-report-20260507-055611.json
strict=True

  [PASS] FP-1   target_element_present
  [PASS] FP-2   viewports_desktop_and_mobile_present
  [PASS] FP-3   screenshot_paths_present
  [PASS] FP-4   screenshot_files_exist
  [PASS] FP-5   screenshot_size_above_floor
  [PASS] FP-6   screenshot_freshness_within_6h
  [PASS] FP-7   screenshot_png_signature
  [PASS] FP-8   trace_zip_integrity
  [PASS] FP-9   dom_measurement_present
          -> per-viewport dom_measurement present: ['desktop', 'mobile']
  [PASS] FP-10  evidence_map_present_with_paths
  [PASS] FP-11  evidence_map_paths_exist_on_disk
  [PASS] FP-12  route_in_screenshot_filename
  [PASS] FP-13  png_dimensions_match_viewport

summary: PASS=13 WARN=0 FAIL=0 N/A=0
