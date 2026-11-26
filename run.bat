@echo off
cd /d "%~dp0"
python -c "import flask, yfinance, pandas" 2>nul || python -m pip install -r requirements.txt
python server.py
pause
