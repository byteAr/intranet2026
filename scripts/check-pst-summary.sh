#!/bin/bash
# check-pst-summary.sh — Cuenta PST/RAR/ZIP por año en el Drive

declare -A YEAR_IDS
YEAR_IDS[2016]="1MRIHcdDvn1EV7TxGpG757vQ-3wxSRM6J"
YEAR_IDS[2018]="1Yu-UBWX6PxhodJFxegGyaysKoUgRSJka"
YEAR_IDS[2021]="100_XQxRTNtxMpROkpcZ8I_RvkxAcL8pH"
YEAR_IDS[2022]="1IrvwsRX6RqMZdRXtDB39c3XXmGShnfJQ"
YEAR_IDS[2023]="19wq2dQxJynwcNMxIzYnmhhM3xStWCCI4"

for year in 2016 2018 2021 2022 2023; do
  ID="${YEAR_IDS[$year]}"
  echo -n "AÑO $year — "
  OUT=$(rclone ls gdrive: --drive-root-folder-id="$ID" 2>&1)
  PST=$(echo "$OUT" | grep -ic "\.pst$")
  RAR=$(echo "$OUT" | grep -ic "\.rar$")
  ZIP=$(echo "$OUT" | grep -ic "\.zip$")
  MSG=$(echo "$OUT" | grep -ic "\.msg$")
  echo "PST:$PST  RAR:$RAR  ZIP:$ZIP  MSG:$MSG"
done
