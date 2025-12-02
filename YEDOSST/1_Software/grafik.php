<div id="grafik-container" style="width: 90%; max-width: 900px; margin: 30px auto; padding: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); background: #fff; border-radius: 8px;">
  <h2 style="text-align:center;">Son 7 Günlük Sıcaklık, Nem ve Toprak Nem Grafiği</h2>
  <canvas id="multiChart" width="800" height="400"></canvas>
</div>

<script src="chart.js/chart.umd.js"></script>

<script>
fetch('grafik_veri.php')
    .then(res => res.json())
    .then(veri => {
        if(veri.error){
            alert('Veri hatası: ' + veri.error);
            return;
        }

        const ctx = document.getElementById('multiChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: veri.labels,
                datasets: [
                    {
                        label: 'Sıcaklık (°C)',
                        data: veri.temperature,
                        borderColor: 'red',
                        backgroundColor: 'rgba(255, 0, 0, 0.1)',
                        spanGaps: true,
                        tension: 0.3
                    },
                    {
                        label: 'Nem (%)',
                        data: veri.humidity,
                        borderColor: 'blue',
                        backgroundColor: 'rgba(0, 0, 255, 0.1)',
                        spanGaps: true,
                        tension: 0.3
                    },
                    {
                        label: 'Toprak Nem (%)',
                        data: veri.soil_moisture,
                        borderColor: 'green',
                        backgroundColor: 'rgba(0, 255, 0, 0.1)',
                        spanGaps: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                scales: {
                    x: { title: { display: true, text: 'Günler' } },
                    y: { title: { display: true, text: 'Değer' }, suggestedMin: 0, suggestedMax: 100 }
                }
            }
        });
    })
    .catch(err => alert('Grafik verisi alınırken hata: ' + err));
</script>
