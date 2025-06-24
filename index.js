const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

let servicesToMonitor = [];

const app = express();
const port = process.env.PORT || 3000;

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'status_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function checkService(service) {
    let isOperational = false;
    let responseTime = 0;
    try {
        const startTime = Date.now();
        const response = await axios.head(service.url, { timeout: 10000 });
        const endTime = Date.now();
        responseTime = endTime - startTime;
        isOperational = response.status >= 200 && response.status < 400;
        console.log(`${service.name}: ${isOperational ? 'Operacional' : 'Caído'} (Tiempo: ${responseTime}ms)`);
    } catch (error) {
        console.error(`${service.name}: Caído - ${error.message}`);
        isOperational = false;
        responseTime = 0;
    } finally {
        try {
            await pool.execute(
                'INSERT INTO service_checks (service_name, timestamp, status, response_time) VALUES (?, NOW(), ?, ?)',
                [service.name, isOperational, responseTime]
            );
        } catch (dbError) {
            console.error(`Error al insertar en la DB para ${service.name}:`, dbError);
        }
    }
}

function loadServicesConfig() {
    try {
        const configContent = fs.readFileSync(path.join(__dirname, 'services.js'), 'utf8');
        const module = { exports: {} };
        eval(configContent.replace('module.exports', 'module.exports = module.exports || {}; module.exports'));
        servicesToMonitor = module.exports;
        console.log(`Configuración de servicios recargada. Total de servicios: ${servicesToMonitor.length}`);
    } catch (error) {
        console.error('Error al recargar la configuración de servicios:', error.message);
    }
}

loadServicesConfig();

cron.schedule('*/19 * * * *', () => {
    console.log('Recargando configuración de servicios desde services.js...');
    loadServicesConfig();
});

cron.schedule('*/5 * * * *', async () => {
    console.log('Ejecutando verificaciones de servicios programadas...');
    for (const service of servicesToMonitor) {
        await checkService(service);
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/services', (req, res) => {
    const servicesInfo = servicesToMonitor.map(service => ({
        id: service.id,
        name: service.name
    }));
    res.json(servicesInfo);
});

app.get('/api/status', async (req, res) => {
    try {
        const results = {};
        for (const service of servicesToMonitor) {
            const [rows] = await pool.execute(
                'SELECT status FROM service_checks WHERE service_name = ? ORDER BY timestamp DESC LIMIT 1',
                [service.name]
            );
            results[service.id] = rows.length > 0 ? Boolean(rows[0].status) : null;
        }
        res.json(results);
    } catch (error) {
        console.error('Error al obtener el estado actual:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/history/:serviceId', async (req, res) => {
    const { serviceId } = req.params;
    const service = servicesToMonitor.find(s => s.id === serviceId);

    if (!service) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoFormatted = ninetyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

        const [rows] = await pool.execute(
            'SELECT timestamp, status FROM service_checks WHERE service_name = ? AND timestamp >= ? ORDER BY timestamp ASC',
            [service.name, ninetyDaysAgoFormatted]
        );

        const dailyData = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let d = new Date(ninetyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            dailyData[dateStr] = { operationalChecks: 0, totalChecks: 0, overallStatus: true };
        }

        rows.forEach(row => {
            const checkDate = new Date(row.timestamp);
            const dateStr = checkDate.toISOString().split('T')[0];

            if (dailyData[dateStr]) {
                dailyData[dateStr].totalChecks++;
                if (row.status) {
                    dailyData[dateStr].operationalChecks++;
                }
                if (!row.status) {
                    dailyData[dateStr].overallStatus = false;
                }
            }
        });

        const processedHistory = Object.keys(dailyData).sort().map(date => {
            const dayInfo = dailyData[date];
            const uptimePercentage = dayInfo.totalChecks > 0
                ? (dayInfo.operationalChecks / dayInfo.totalChecks) * 100
                : 100;

            return {
                date: date,
                uptime: parseFloat(uptimePercentage.toFixed(2)),
                status: dayInfo.overallStatus
            };
        });

        let totalUptimeSum = 0;
        let totalDaysCounted = 0;
        for (const day of processedHistory) {
            totalUptimeSum += day.uptime;
            totalDaysCounted++;
        }
        const overallUptime = totalDaysCounted > 0 ? (totalUptimeSum / totalDaysCounted) : 100;

        res.json({
            service: service.name,
            history: processedHistory,
            overallUptime: parseFloat(overallUptime.toFixed(2))
        });

    } catch (error) {
        console.error(`Error al obtener el historial para ${serviceId}:`, error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.use((req, res, next) => {
    res.status(404).send("Lo siento, no se encontró la página.");
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal en el servidor!');
});

app.listen(port, () => {
    console.log(`Servidor de estado corriendo en http://localhost:${port}`);
    console.log('Realizando verificaciones de servicios iniciales...');
    for (const service of servicesToMonitor) {
        checkService(service);
    }
});