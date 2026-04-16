#!/bin/bash
# check-pst-summary.sh — Cuenta PST/RAR/ZIP/MSG por año en el Drive

declare -A YEAR_IDS
YEAR_IDS[2011]="1OthnG2bvWdZku7TErwKHihOoP-IF1XwG"
YEAR_IDS[2012]="1aOMswFZkit1GAD-n_lFIC9IgTOUwVeni"
YEAR_IDS[2013]="1pZUHo_RK2wjcudSo6KYG4zD8WWRuf001"
YEAR_IDS[2014]="1VdNqfnlMhVv1poo4HEDyYrw79U1ZL1aw"
YEAR_IDS[2015]="1HSLV_c3PJVVe9Ka1DwfJcOVYndFKbntU"
YEAR_IDS[2016]="1MRIHcdDvn1EV7TxGpG757vQ-3wxSRM6J"
YEAR_IDS[2018]="1Yu-UBWX6PxhodJFxegGyaysKoUgRSJka"
YEAR_IDS[2021]="100_XQxRTNtxMpROkpcZ8I_RvkxAcL8pH"
YEAR_IDS[2022]="1IrvwsRX6RqMZdRXtDB39c3XXmGShnfJQ"
YEAR_IDS[2023]="19wq2dQxJynwcNMxIzYnmhhM3xStWCCI4"

YEARS="${1:-2011 2012 2013 2014 2015 2016 2018 2021 2022 2023}"

for year in $YEARS; do
  ID="${YEAR_IDS[$year]}"
  echo -n "AÑO $year — "
  OUT=$(rclone ls gdrive: --drive-root-folder-id="$ID" 2>&1)
  PST=$(echo "$OUT" | grep -ic "\.pst$")
  RAR=$(echo "$OUT" | grep -ic "\.rar$")
  ZIP=$(echo "$OUT" | grep -ic "\.zip$")
  MSG=$(echo "$OUT" | grep -ic "\.msg$")
  echo "PST:$PST  RAR:$RAR  ZIP:$ZIP  MSG:$MSG"
done
