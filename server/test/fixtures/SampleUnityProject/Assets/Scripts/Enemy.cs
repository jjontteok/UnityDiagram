using UnityEngine;

public class Enemy : EntityBase {
    Rigidbody2D rb;
    void Awake() { rb = GetComponent<Rigidbody2D>(); }
    public override void TakeDamage(int amount) { GameManager.Instance.AddScore(10); }
}
