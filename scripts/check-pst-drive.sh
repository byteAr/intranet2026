#!/bin/bash
# check-pst-drive.sh — Verifica qué PST/RAR hay en cada año del Drive

declare -A YEAR_IDS
YEAR_IDS[2016]="1MRIHcdDvn1EV7TxGpG757vQ-3wxSRM6J"
YEAR_IDS[2018]="1Yu-UBWX6PxhodJFxegGyaysKoUgRSJka"
YEAR_IDS[2021]="100_XQxRTNtxMpROkpcZ8I_RvkxAcL8pH"
YEAR_IDS[2022]="1IrvwsRX6RqMZdRXtDB39c3XXmGShnfJQ"
YEAR_IDS[2023]="19wq2dQxJynwcNMxIzYnmhhM3xStWCCI4"

for year in 2016 2018 2021 2022 2023; do
  ID="${YEAR_IDS[$year]}"
  echo ""
  echo "=== AÑO $year ==="
  rclone ls gdrive: --drive-root-folder-id="$ID" 2>&1 | grep -i "\.pst\|\.rar\|\.zip" || echo "  (ninguno)"
done
