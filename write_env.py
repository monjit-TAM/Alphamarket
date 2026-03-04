with open('.env', 'w') as f:
    f.write('DEBUG=false\n')
    f.write('SECRET_KEY=alphaforge2026productionkey32charssecret\n')
    f.write('ADMIN_EMAIL=monjit@alphamarket.co.in\n')
    f.write('GROWW_AUTH_FLOW=totp\n')
    f.write('GROWW_API_KEY=eyJraWQiOiJaTUtjVXciLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjI1NTk4ODkzMDEsImlhdCI6MTc3MTQ4OTMwMSwibmJmIjoxNzcxNDg5MzAxLCJzdWIiOiJ7XCJ0b2tlblJlZklkXCI6XCJmODQxYWZhOS02YzAzLTRhMDgtYmNkNi05MGE0YWUxYzViZmNcIixcInZlbmRvckludGVncmF0aW9uS2V5XCI6XCJlMzFmZjIzYjA4NmI0MDZjODg3NGIyZjZkODQ5NTMxM1wiLFwidXNlckFjY291bnRJZFwiOlwiMzgwNzJlZmEtYTI5ZC00MDgzLThiN2QtZTAyOTliYjczMzQwXCIsXCJkZXZpY2VJZFwiOlwiMTg4YTA4ZWUtY2I5OS01OGVhLWE5ZWQtZjU0NTI2ODg5N2JmXCIsXCJzZXNzaW9uSWRcIjpcImRmYzJhNDk3LWUwNzctNDA4MC05MWM0LThiOTg2NTk0OTMyY1wiLFwiYWRkaXRpb25hbERhdGFcIjpcIno1NC9NZzltdjE2WXdmb0gvS0EwYkdQWVFRMktPbXBBcm5HOWhSdytnRVpSTkczdTlLa2pWZDNoWjU1ZStNZERhWXBOVi9UOUxIRmtQejFFQisybTdRPT1cIixcInJvbGVcIjpcImF1dGgtdG90cFwiLFwic291cmNlSXBBZGRyZXNzXCI6XCIyMjMuMTg1LjEzNC4xMjcsMTcyLjY4LjIzOS4yMTgsMzUuMjQxLjIzLjEyM1wiLFwidHdvRmFFeHBpcnlUc1wiOjI1NTk4ODkzMDE5NDN9IiwiaXNzIjoiYXBleC1hdXRoLXByb2QtYXBwIn0.nt7Nhz4xqamwcjm4uEUIpzEsdIB-2Y3nAFhOZUMtO2gOvv3dVnuCAt6EwNlM39t3AKarDjhcf-MKzZ9cYNuT7A \n') f.write('GROWW_TOTP_SECRET=CDO6IACMYYGXTFPGTMU7KZ2LXLSIOPC6\n')
    f.write('GROWW_TOTP_SECRET=CDO6IACMYYGXTFPGTMU7KZ2LXLSIOPC6\n')
    f.write('DATABASE_URL=postgresql://alphaforge:AlphaForge2026@localhost:5432/alphaforge\n')
    f.write('REDIS_URL=redis://localhost:6379\n')
    f.write('ALLOWED_ORIGINS=["https://testalpha.in","http://159.89.162.181"]\n')
    f.write('MAX_USERS=100\n')
    f.write('INVITE_ONLY=true\n')
print('DONE')

