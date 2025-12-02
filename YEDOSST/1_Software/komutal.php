<?php
$conn = new mysqli("localhost", "root", "", "veriler");

$result = $conn->query("SELECT * FROM commands WHERE is_executed = 0 ORDER BY id ASC LIMIT 1");

if ($row = $result->fetch_assoc()) {
    echo $row['command'];
    $conn->query("UPDATE commands SET is_executed = 1 WHERE id = " . $row['id']);
} else {
    echo "none";
}
?>

