<?php
date_default_timezone_set("Europe/Istanbul");  

$day = date("l");          
$time = date("H:i:s");      

$conn = new mysqli("localhost", "root", "", "veriler");
if ($conn->connect_error) {
    http_response_code(500);
    echo "Veritabanı hatası";
    exit;
}

$sql = "SELECT valve_id FROM schedule 
        WHERE day_of_week = '$day' 
        AND '$time' BETWEEN start_time AND end_time";

$result = $conn->query($sql);

$acik_valfler = [];
while ($row = $result->fetch_assoc()) {
    $acik_valfler[] = intval($row['valve_id']);
}

header('Content-Type: application/json');
echo json_encode($acik_valfler);
?>