document.addEventListener('DOMContentLoaded', async () => {
    const servicesContainer = document.getElementById('services-container');
    const mainStatusHeading = document.getElementById('main-status-heading');
    const historyModal = document.getElementById('historyModal');
    const closeButton = document.querySelector('.close-button');
    const modalServiceName = document.getElementById('modal-service-name');
    const modalOverallUptime = document.getElementById('modal-overall-uptime');
    const calendarContainer = document.getElementById('calendar-container');

    let servicesToDisplay = [];
    try {
        const response = await fetch('/api/services');
        if (!response.ok) {
            throw new Error(`Error al obtener la lista de servicios: ${response.status}`);
        }
        servicesToDisplay = await response.json();
        if (!Array.isArray(servicesToDisplay) || servicesToDisplay.length === 0) {
            console.warn("No se encontraron servicios configurados. Verifique 'services.js'.");
            servicesContainer.innerHTML = '<p>No hay servicios para mostrar. Configure sus servicios en el backend.</p>';
            mainStatusHeading.textContent = 'Sin Servicios Configurados';
            document.querySelector('.header').style.backgroundColor = '#6c757d';
            return;
        }
    } catch (error) {
        console.error('Error al cargar la lista de servicios:', error);
        servicesContainer.innerHTML = `<p style="color: red;">Error al cargar los servicios: ${error.message}</p>`;
        mainStatusHeading.textContent = 'Error al Cargar Servicios';
        document.querySelector('.header').style.backgroundColor = '#dc3545';
        return;
    }

    let allOperational = true;

    for (const service of servicesToDisplay) {
        const serviceCard = document.createElement('div');
        serviceCard.className = 'service-card';
        serviceCard.innerHTML = `
            <div class="service-header">
                <span class="service-name">${service.name}</span>
                <span class="service-status loading" id="${service.id}-status">Cargando...</span>
            </div>
            <div class="uptime-bars" id="${service.id}-bars">
            </div>
            <div class="uptime-percentage" id="${service.id}-percentage"></div>
            <button class="history-button" data-service-id="${service.id}" data-service-name="${service.name}">Ver Historial</button>
        `;
        servicesContainer.appendChild(serviceCard);

        const currentServiceStatus = await fetchServiceData(service.id, service.name);
        if (currentServiceStatus === false) {
            allOperational = false;
        }
    }

    if (allOperational) {
        mainStatusHeading.textContent = 'Todos los Sistemas Operacionales';
        document.querySelector('.header').style.backgroundColor = '#28a745';
    } else {
        mainStatusHeading.textContent = 'Algunos Sistemas Degradados';
        document.querySelector('.header').style.backgroundColor = '#ffc107';
    }

    servicesContainer.addEventListener('click', async (event) => {
        if (event.target.classList.contains('history-button')) {
            const serviceId = event.target.dataset.serviceId;
            const serviceName = event.target.dataset.serviceName;
            await displayServiceHistory(serviceId, serviceName);
        }
    });

    closeButton.onclick = () => {
        historyModal.style.display = 'none';
    };

    window.onclick = (event) => {
        if (event.target == historyModal) {
            historyModal.style.display = 'none';
        }
    };
});

async function fetchServiceData(serviceId, serviceName) {
    const statusElement = document.getElementById(`${serviceId}-status`);
    const barsElement = document.getElementById(`${serviceId}-bars`);
    const percentageElement = document.getElementById(`${serviceId}-percentage`);

    let currentServiceStatus = null;

    try {
        const historyResponse = await fetch(`/api/history/${serviceId}`);
        if (!historyResponse.ok) {
            throw new Error(`Error HTTP! Estado: ${historyResponse.status}`);
        }
        const historyData = await historyResponse.json();
        const history = historyData.history;
        const overallUptime = historyData.overallUptime;

        const currentStatusResponse = await fetch('/api/status');
        if (!currentStatusResponse.ok) {
            throw new Error(`Error HTTP! Estado: ${currentStatusResponse.status}`);
        }
        const currentStatusData = await currentStatusResponse.json();
        currentServiceStatus = currentStatusData[serviceId];

        barsElement.innerHTML = '';
        const today = new Date();
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(today.getDate() - 90);

        const dailyHistoryMap = new Map();
        history.forEach(day => dailyHistoryMap.set(day.date, day));

        for (let d = new Date(ninetyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const bar = document.createElement('div');
            bar.className = 'bar';

            const dayInfo = dailyHistoryMap.get(dateStr);

            if (dayInfo) {
                if (dayInfo.status === true) {
                    bar.classList.add('operational');
                } else {
                    bar.classList.add('down');
                }
                if (dayInfo.totalChecks > 0 && dayInfo.uptime < 100 && dayInfo.uptime > 0) {
                    bar.classList.add('partial-downtime');
                }
                bar.title = `${dateStr}: ${dayInfo.uptime.toFixed(2)}% de Uptime`;
            } else {
                bar.classList.add('no-data'); // Cambiado a 'no-data' para reflejar que no hay checks
                bar.title = `${dateStr}: Sin datos de monitoreo`;
            }

            const isToday = d.toISOString().split('T')[0] === today.toISOString().split('T')[0];
            if (isToday) {
                if (currentServiceStatus === false) {
                    bar.classList.remove('operational', 'partial-downtime', 'no-data');
                    bar.classList.add('down');
                    bar.title = `HOY (${dateStr}): CAÍDO (estado actual)`;
                } else if (currentServiceStatus === true) {
                    bar.classList.remove('down', 'partial-downtime', 'no-data');
                    bar.classList.add('operational');
                    bar.title = `HOY (${dateStr}): OPERACIONAL (estado actual)`;
                }
            }
            barsElement.appendChild(bar);
        }

        percentageElement.textContent = `${overallUptime.toFixed(2)} % uptime`;

        if (currentServiceStatus === true) {
            statusElement.textContent = 'Operacional';
            statusElement.className = 'service-status operational';
        } else if (currentServiceStatus === false) {
            statusElement.textContent = 'Caído';
            statusElement.className = 'service-status down';
        } else {
            statusElement.textContent = 'Estado desconocido';
            statusElement.className = 'service-status error';
        }

    } catch (error) {
        console.error(`Error al obtener datos para ${serviceName}:`, error);
        statusElement.textContent = 'Error';
        statusElement.className = 'service-status error';
        percentageElement.textContent = 'N/A % uptime';
        barsElement.innerHTML = `<div class="bar error" style="flex-grow: 100;"></div>`;
        currentServiceStatus = null;
    }
    return currentServiceStatus;
}

async function displayServiceHistory(serviceId, serviceName) {
    const modalServiceName = document.getElementById('modal-service-name');
    const modalOverallUptime = document.getElementById('modal-overall-uptime');
    const calendarContainer = document.getElementById('calendar-container');
    const historyModal = document.getElementById('historyModal');

    modalServiceName.textContent = serviceName;
    calendarContainer.innerHTML = '';
    modalOverallUptime.textContent = 'Cargando...';

    historyModal.style.display = 'flex';

    try {
        const historyResponse = await fetch(`/api/history/${serviceId}`);
        if (!historyResponse.ok) {
            throw new Error(`Error HTTP! Estado: ${historyResponse.status}`);
        }
        const historyData = await historyResponse.json();
        const history = historyData.history;
        const overallUptime = historyData.overallUptime;

        modalOverallUptime.textContent = `${overallUptime.toFixed(2)}%`;

        const today = new Date();
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(today.getDate() - 90);

        const dailyHistoryMap = new Map();
        history.forEach(day => dailyHistoryMap.set(day.date, day));

        // Calcular el día de la semana del primer día a mostrar (ninetyDaysAgo)
        // new Date().getDay() devuelve 0 para domingo, 1 para lunes, etc.
        const firstDayToShow = new Date(ninetyDaysAgo);
        const startDayOfWeek = firstDayToShow.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

        // Rellenar con celdas vacías para alinear el primer día con su día de la semana
        for (let i = 0; i < startDayOfWeek; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day empty';
            calendarContainer.appendChild(emptyDay);
        }

        for (let d = new Date(ninetyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayOfMonth = d.getDate();
            const calendarDay = document.createElement('div');
            calendarDay.className = 'calendar-day';

            const dayInfo = dailyHistoryMap.get(dateStr);

            let statusClass = 'no-data'; // Nuevo: Clase para días sin datos de chequeo
            let titleText = `${dateStr}: Sin datos de monitoreo`;

            if (dayInfo) {
                if (dayInfo.status === true) { // Si el estado general del día es TRUE
                    statusClass = 'operational';
                } else { // Si el estado general del día es FALSE
                    statusClass = 'down';
                }
                // Si hubo checks, y el uptime no es 100% ni 0%, es parcial
                if (dayInfo.totalChecks > 0 && dayInfo.uptime < 100 && dayInfo.uptime > 0) {
                    statusClass = 'partial-downtime';
                }
                titleText = `${dateStr}: ${dayInfo.uptime.toFixed(2)}% de Uptime`;
            }

            calendarDay.classList.add(statusClass);
            calendarDay.title = titleText;
            calendarDay.textContent = dayOfMonth;

            calendarContainer.appendChild(calendarDay);
        }

    } catch (error) {
        console.error(`Error al obtener el historial para ${serviceName}:`, error);
        modalOverallUptime.textContent = 'Error al cargar';
        calendarContainer.innerHTML = '<p style="color: red;">No se pudo cargar el historial.</p>';
    }
}