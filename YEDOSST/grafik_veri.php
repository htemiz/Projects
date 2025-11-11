<?php

$conn = new mysqli("localhost", "root", "", "veriler");
if ($conn->connect_error) {
    echo json_encode(['error' => "Bağlantı hatası: " . $conn->connect_error]);
    exit;
}

$gunler = ['Paz', 'Pzt', 'Salı', 'Çrş', 'Prş', 'Cuma', 'Cmt'];
$tarihEtiketleri = [];
$sicaklikVerileri = [];
$nemVerileri = [];
$toprakNemVerileri = [];

for ($i = 6; $i >= 0; $i--) {
    $tarih = date('Y-m-d', strtotime("-$i days"));
    $gunIndex = date('w', strtotime($tarih));
    $tarihEtiketleri[] = $gunler[$gunIndex];

    $sql = "SELECT 
                AVG(temperature) as ort_sicaklik, 
                AVG(humidity) as ort_nem, 
                AVG(soil_moisture) as ort_toprak_nem
            FROM sensor_data WHERE DATE(timestamp) = '$tarih'";
    $result = $conn->query($sql);
    if (!$result) {
        echo json_encode(['error' => "SQL Hatası: " . $conn->error]);
        exit;
    }
    if ($row = $result->fetch_assoc()) {
        $sicaklikVerileri[] = is_null($row['ort_sicaklik']) ? null : round($row['ort_sicaklik'], 2);
        $nemVerileri[] = is_null($row['ort_nem']) ? null : round($row['ort_nem'], 2);
        $toprakNemVerileri[] = is_null($row['ort_toprak_nem']) ? null : round($row['ort_toprak_nem'], 2);
    } else {
        $sicaklikVerileri[] = null;
        $nemVerileri[] = null;
        $toprakNemVerileri[] = null;
    }
}

echo json_encode([
    'labels' => $tarihEtiketleri,
    'temperature' => $sicaklikVerileri,
    'humidity' => $nemVerileri,
    'soil_moisture' => $toprakNemVerileri
]);
