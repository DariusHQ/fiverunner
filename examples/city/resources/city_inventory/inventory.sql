CREATE TABLE items (
    citizen VARCHAR(60) NOT NULL,
    item VARCHAR(20) NOT NULL,
    amount INT NOT NULL,
    PRIMARY KEY (citizen, item)
);
