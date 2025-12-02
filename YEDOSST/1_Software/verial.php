<?php
$host = "localhost";
$user = "root";
$pass = "";
$db = "veriler";

$conn = new mysqli($host, $user, $pass, $db);

$temp = $_GET['temp'];
$hum = $_GET['hum'];
$soil = $_GET['soil'];
$rain = $_GET['rain'];

$stmt = $conn->prepare("INSERT INTO sensor_data (temperature, humidity, soil_moisture, is_raining) VALUES (?, ?, ?, ?)");
$stmt->bind_param("dddi", $temp, $hum, $soil, $rain);
$stmt->execute();

// If it's raining ($rain = 0 means rain is present), automatically close both valves
if ($rain == 0) {
    $conn->query("INSERT INTO commands (command) VALUES ('valve_ac1')");
    $conn->query("INSERT INTO commands (command) VALUES ('valve_ac2')");
}

echo "OK";
?>
