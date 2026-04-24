#!/bin/bash
# Descarga los años 2011-2017 desde Google Drive al servidor
# Uso: bash scripts/download-missing-years.sh

DEST="/usr/local/proyectos/intranet2026/storage/msg-import"

for year in 2011 2012 2013 2014 2015 2016 2017; do
  if [ "$year" = "2011" ]; then ID="1OthnG2bvWdZku7TErwKHihOoP-IF1XwG"
  elif [ "$year" = "2012" ]; then ID="1aOMswFZkit1GAD-n_lFIC9IgTOUwVeni"
  elif [ "$year" = "2013" ]; then ID="1pZUHo_RK2wjcudSo6KYG4zD8WWRuf001"
  elif [ "$year" = "2014" ]; then ID="1VdNqfnlMhVv1poo4HEDyYrw79U1ZL1aw"
  elif [ "$year" = "2015" ]; then ID="1HSLV_c3PJVVe9Ka1DwfJcOVYndFKbntU"
  elif [ "$year" = "2016" ]; then ID="1MRIHcdDvn1EV7TxGpG757vQ-3wxSRM6J"
  elif [ "$year" = "2017" ]; then ID="1cOl570yfU_FHywdhvqJ9lioZx_b4y5OP"
  fi
  echo "=== Descargando AÑO $year ==="
  rclone copy gdrive: "$DEST/AÑO $year" \
    --drive-root-folder-id="$ID" \
    --include "**.msg" \
    --progress
  echo "=== AÑO $year finalizado ==="
done
