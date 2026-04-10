#!/bin/bash
cp /var/www/alphamarket/server/broker-swagger.json /var/www/alphamarket/dist/public/broker-swagger.json 2>/dev/null
cp /var/www/alphamarket/server/broker-guide.html /var/www/alphamarket/dist/public/broker-guide.html 2>/dev/null
echo "Post-build: broker assets copied"
